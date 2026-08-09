import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  chmod,
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  resolve,
  win32,
} from 'node:path';

import {
  ProductSemVerSchema,
  RunnerSoftwareIdentitySchema,
  Sha256HexSchema,
} from '@tasktwin/runner-release';
import { RunnerServiceRuntimeError } from '@tasktwin/runner-service-runtime';
import { RunnerActivationIdSchema } from '@tasktwin/runner-update';
import { z } from 'zod';

import { runnerWindowsServiceName } from './windows-service-identity.js';

const WIN_SW_SHA256 =
  'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f';
const MAX_PROCESS_OUTPUT_BYTES = 32 * 1024;
const SERVICE_OPERATION_TIMEOUT_MS = 180_000;
const SERVICE_STATE_POLL_INTERVAL_MS = 250;
const MIN_SERVICE_WAIT_TIMEOUT_MS = 1_000;
const MAX_SERVICE_WAIT_TIMEOUT_MS = 10 * 60_000;

const AbsolutePathSchema = z
  .string()
  .min(3)
  .max(1_024)
  .refine((value) => isAbsolute(value) && !value.includes('\0'));

export const WindowsRunnerServiceConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    serviceName: z.string().regex(/^TaskTwinRunner_[0-9a-f]{32}$/),
    runnerDeviceId: z.string().uuid(),
    dataRoot: AbsolutePathSchema,
    nodeExecutable: AbsolutePathSchema,
    runnerEntryPoint: AbsolutePathSchema,
  })
  .superRefine((value, context) => {
    if (value.serviceName !== runnerWindowsServiceName(value.runnerDeviceId)) {
      context.addIssue({
        code: 'custom',
        path: ['serviceName'],
        message: 'The service name does not match the Runner identity.',
      });
    }
  });

export const WindowsRunnerServiceActivationConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    activationId: RunnerActivationIdSchema,
    releaseVersion: ProductSemVerSchema,
    manifestSha256: Sha256HexSchema,
    serviceName: z.string().regex(/^TaskTwinRunner_[0-9a-f]{32}$/),
    runnerDeviceId: z.string().uuid(),
    dataRoot: AbsolutePathSchema,
    nodeExecutable: AbsolutePathSchema,
    runnerEntryPoint: AbsolutePathSchema,
    serviceConfigPath: AbsolutePathSchema,
    serviceExecutablePath: AbsolutePathSchema,
    serviceXmlPath: AbsolutePathSchema,
    startupStatusPath: AbsolutePathSchema,
    updateJournalPath: AbsolutePathSchema,
    logDirectory: AbsolutePathSchema,
    softwareIdentity: RunnerSoftwareIdentitySchema,
    requireNativeSecretAutoUnlock: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.serviceName !== runnerWindowsServiceName(value.runnerDeviceId)) {
      context.addIssue({
        code: 'custom',
        path: ['serviceName'],
        message: 'The service name does not match the Runner identity.',
      });
    }
    if (
      value.releaseVersion !== value.softwareIdentity.version ||
      value.softwareIdentity.platform !== 'windows' ||
      value.softwareIdentity.architecture !== 'x64'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['softwareIdentity'],
        message: 'The activation software identity is inconsistent.',
      });
    }
    const executable = parse(value.serviceExecutablePath);
    const xml = parse(value.serviceXmlPath);
    if (
      extname(value.serviceExecutablePath).toLowerCase() !== '.exe' ||
      extname(value.serviceXmlPath).toLowerCase() !== '.xml' ||
      !sameWindowsPath(executable.dir, xml.dir) ||
      !sameWindowsPath(executable.dir, dirname(value.serviceConfigPath)) ||
      executable.name.toLowerCase() !== xml.name.toLowerCase() ||
      basename(value.serviceExecutablePath).toLowerCase() !==
        `${value.serviceName}.exe`.toLowerCase() ||
      basename(value.serviceConfigPath).toLowerCase() !==
        'runner-service.v1.json'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['serviceExecutablePath'],
        message: 'The WinSW executable and XML activation binding is invalid.',
      });
    }
  });

export type WindowsRunnerServiceConfig = z.infer<
  typeof WindowsRunnerServiceConfigSchema
>;
export type WindowsRunnerServiceActivationConfig = z.infer<
  typeof WindowsRunnerServiceActivationConfigSchema
>;
export interface WindowsRunnerServiceActivationProof {
  readonly activationId: string;
  readonly activationConfigPath: string;
  readonly activationConfigSha256: string;
  readonly serviceConfigPath: string;
  readonly serviceConfigSha256: string;
  readonly serviceExecutablePath: string;
  readonly serviceExecutableSha256: string;
  readonly serviceXmlPath: string;
  readonly serviceXmlSha256: string;
  readonly criticalRuntimeFiles: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}
export type WindowsRunnerServiceState =
  'not_installed' | 'stopped' | 'running' | 'unknown';

export interface WindowsServiceCommandResult {
  readonly code: number;
  readonly output: string;
}

export interface WindowsServiceCommandRunner {
  run(
    executable: string,
    args: readonly string[],
  ): Promise<WindowsServiceCommandResult>;
}

export async function readWindowsRunnerServiceConfig(
  path: string,
): Promise<WindowsRunnerServiceConfig> {
  return readStrictConfiguration(path, WindowsRunnerServiceConfigSchema);
}

export async function readWindowsRunnerServiceActivationConfig(
  path: string,
): Promise<WindowsRunnerServiceActivationConfig> {
  return readStrictConfiguration(
    path,
    WindowsRunnerServiceActivationConfigSchema,
  );
}

export interface PrepareWindowsRunnerActivationInput {
  readonly activationId: string;
  readonly releaseVersion: string;
  readonly manifestSha256: string;
  readonly runnerDeviceId: string;
  readonly activationDirectory: string;
  readonly dataRoot: string;
  readonly nodeExecutable: string;
  readonly runnerEntryPoint: string;
  readonly startupStatusPath: string;
  readonly updateJournalPath: string;
  readonly logDirectory: string;
  readonly softwareIdentity: z.input<typeof RunnerSoftwareIdentitySchema>;
  readonly requireNativeSecretAutoUnlock: boolean;
}

export class WindowsRunnerServiceManager {
  readonly serviceDirectory: string;
  readonly wrapperPath: string;
  private readonly commandRunner: WindowsServiceCommandRunner;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly scExecutable: string;
  private readonly icaclsExecutable: string;

  constructor(
    private readonly runnerEntryPoint: string,
    private readonly dataRoot: string,
    programData = process.env['ProgramData'],
    dependencies: {
      readonly platform?: NodeJS.Platform;
      readonly systemRoot?: string;
      readonly commandRunner?: WindowsServiceCommandRunner;
      readonly sleep?: (milliseconds: number) => Promise<void>;
    } = {},
  ) {
    if (
      (dependencies.platform ?? process.platform) !== 'win32' ||
      programData === undefined
    ) {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_PLATFORM_UNSUPPORTED',
      );
    }
    this.runnerEntryPoint = validatedAbsolutePath(runnerEntryPoint);
    this.dataRoot = validatedAbsolutePath(dataRoot);
    const applicationRoot = resolve(dirname(this.runnerEntryPoint), '..');
    this.wrapperPath = join(
      applicationRoot,
      'windows',
      'vendor',
      'winsw-2.12.0',
      'WinSW.NET461.exe',
    );
    this.serviceDirectory = join(programData, 'TaskTwin', 'RunnerServices');
    const system32 = join(
      validatedAbsolutePath(
        dependencies.systemRoot ?? process.env['SystemRoot'] ?? 'C:\\Windows',
      ),
      'System32',
    );
    this.scExecutable = join(system32, 'sc.exe');
    this.icaclsExecutable = join(system32, 'icacls.exe');
    this.commandRunner = dependencies.commandRunner ?? {
      run: invokeAllowFailure,
    };
    this.sleep =
      dependencies.sleep ??
      ((milliseconds) =>
        new Promise<void>((resolvePromise) => {
          setTimeout(resolvePromise, milliseconds);
        }));
  }

  async install(runnerDeviceId: string): Promise<void> {
    await this.verifyWrapper();
    const config = this.buildConfig(runnerDeviceId);
    const instanceDirectory = join(this.serviceDirectory, config.serviceName);
    const activationDirectory = join(instanceDirectory, 'current');
    await mkdir(activationDirectory, { recursive: true, mode: 0o700 });
    const serviceConfigPath = join(instanceDirectory, 'runner-service.v1.json');
    const serviceExecutablePath = join(
      activationDirectory,
      `${config.serviceName}.exe`,
    );
    const serviceXmlPath = join(
      activationDirectory,
      `${config.serviceName}.xml`,
    );
    await copyVerifiedWrapper(this.wrapperPath, serviceExecutablePath, true);
    await writeAtomic(serviceConfigPath, `${JSON.stringify(config)}\n`, true);
    await writeAtomic(
      serviceXmlPath,
      buildWindowsServiceXml(
        config,
        serviceConfigPath,
        join(instanceDirectory, 'logs'),
      ),
      true,
    );
    await this.invoke(serviceExecutablePath, ['install']);
    if (
      !sameWindowsPath(
        (await this.currentBinaryPath(runnerDeviceId)) ?? '',
        serviceExecutablePath,
      )
    ) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
    }
    await this.invoke(this.scExecutable, [
      'sidtype',
      config.serviceName,
      'unrestricted',
    ]);
    await this.invoke(this.icaclsExecutable, [
      join(this.dataRoot, '.tasktwin'),
      '/grant',
      `NT SERVICE\\${config.serviceName}:(OI)(CI)M`,
      '/T',
      '/C',
    ]);
  }

  async prepareActivation(
    input: PrepareWindowsRunnerActivationInput,
  ): Promise<WindowsRunnerServiceActivationConfig> {
    await this.verifyWrapper();
    const activationDirectory = validatedAbsolutePath(
      input.activationDirectory,
    );
    await mkdir(activationDirectory, { recursive: true, mode: 0o700 });
    const serviceName = runnerWindowsServiceName(input.runnerDeviceId);
    const serviceExecutablePath = join(
      activationDirectory,
      `${serviceName}.exe`,
    );
    const serviceXmlPath = join(activationDirectory, `${serviceName}.xml`);
    const serviceConfigPath = join(
      activationDirectory,
      'runner-service.v1.json',
    );
    const activationConfigPath = join(
      activationDirectory,
      'runner-service-activation.v1.json',
    );
    const serviceConfig = WindowsRunnerServiceConfigSchema.parse({
      schemaVersion: 1,
      serviceName,
      runnerDeviceId: input.runnerDeviceId,
      dataRoot: input.dataRoot,
      nodeExecutable: input.nodeExecutable,
      runnerEntryPoint: input.runnerEntryPoint,
    });
    const activation = WindowsRunnerServiceActivationConfigSchema.parse({
      schemaVersion: 1,
      activationId: input.activationId,
      releaseVersion: input.releaseVersion,
      manifestSha256: input.manifestSha256,
      serviceName,
      runnerDeviceId: input.runnerDeviceId,
      dataRoot: input.dataRoot,
      nodeExecutable: input.nodeExecutable,
      runnerEntryPoint: input.runnerEntryPoint,
      serviceConfigPath,
      serviceExecutablePath,
      serviceXmlPath,
      startupStatusPath: input.startupStatusPath,
      updateJournalPath: input.updateJournalPath,
      logDirectory: input.logDirectory,
      softwareIdentity: input.softwareIdentity,
      requireNativeSecretAutoUnlock: input.requireNativeSecretAutoUnlock,
    });
    await copyVerifiedWrapper(this.wrapperPath, serviceExecutablePath, false);
    await writeAtomic(
      serviceConfigPath,
      `${JSON.stringify(serviceConfig)}\n`,
      false,
    );
    await writeAtomic(
      activationConfigPath,
      `${JSON.stringify(activation)}\n`,
      false,
    );
    await writeAtomic(
      serviceXmlPath,
      buildWindowsServiceXml(
        serviceConfig,
        serviceConfigPath,
        activation.logDirectory,
        activationConfigPath,
      ),
      false,
    );
    return activation;
  }

  async attestActivation(input: {
    readonly activationConfigPath: string;
    readonly expected: WindowsRunnerServiceActivationConfig;
  }): Promise<WindowsRunnerServiceActivationProof> {
    const expected = WindowsRunnerServiceActivationConfigSchema.parse(
      input.expected,
    );
    const activationConfigPath = validatedAbsolutePath(
      input.activationConfigPath,
    );
    const activationDirectory = dirname(expected.serviceExecutablePath);
    if (
      !sameWindowsPath(
        activationConfigPath,
        join(activationDirectory, 'runner-service-activation.v1.json'),
      ) ||
      !sameWindowsPath(
        expected.serviceConfigPath,
        join(activationDirectory, 'runner-service.v1.json'),
      ) ||
      !sameWindowsPath(
        expected.serviceXmlPath,
        join(activationDirectory, `${expected.serviceName}.xml`),
      )
    ) {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_CONFIGURATION_INVALID',
      );
    }
    const serviceConfig = WindowsRunnerServiceConfigSchema.parse({
      schemaVersion: 1,
      serviceName: expected.serviceName,
      runnerDeviceId: expected.runnerDeviceId,
      dataRoot: expected.dataRoot,
      nodeExecutable: expected.nodeExecutable,
      runnerEntryPoint: expected.runnerEntryPoint,
    });
    const expectedActivationContents = `${JSON.stringify(expected)}\n`;
    const expectedServiceConfigContents = `${JSON.stringify(serviceConfig)}\n`;
    const expectedServiceXmlContents = buildWindowsServiceXml(
      serviceConfig,
      expected.serviceConfigPath,
      expected.logDirectory,
      activationConfigPath,
    );
    const criticalRuntimePaths = [
      expected.nodeExecutable,
      expected.runnerEntryPoint,
      join(
        dirname(expected.runnerEntryPoint),
        'release',
        'build-identity.json',
      ),
    ];
    const criticalRuntimeDigests = await Promise.all(
      criticalRuntimePaths.map((path) =>
        sha256RegularFile(path, 256 * 1024 * 1024),
      ),
    );
    await Promise.all([
      assertExactRegularFile(
        activationConfigPath,
        expectedActivationContents,
        16 * 1024,
      ),
      assertExactRegularFile(
        expected.serviceConfigPath,
        expectedServiceConfigContents,
        16 * 1024,
      ),
      assertExactRegularFile(
        expected.serviceXmlPath,
        expectedServiceXmlContents,
        64 * 1024,
      ),
      assertVerifiedServiceExecutable(expected.serviceExecutablePath),
    ]);
    const criticalRuntimeFiles = Object.freeze(
      criticalRuntimePaths.map((path, index) =>
        Object.freeze({ path, sha256: criticalRuntimeDigests[index] ?? '' }),
      ),
    );
    return Object.freeze({
      activationId: expected.activationId,
      activationConfigPath,
      activationConfigSha256: sha256Text(expectedActivationContents),
      serviceConfigPath: expected.serviceConfigPath,
      serviceConfigSha256: sha256Text(expectedServiceConfigContents),
      serviceExecutablePath: expected.serviceExecutablePath,
      serviceExecutableSha256: WIN_SW_SHA256,
      serviceXmlPath: expected.serviceXmlPath,
      serviceXmlSha256: sha256Text(expectedServiceXmlContents),
      criticalRuntimeFiles,
    });
  }

  async start(runnerDeviceId: string): Promise<void> {
    await this.startAndWait(runnerDeviceId);
  }

  async stop(runnerDeviceId: string): Promise<void> {
    await this.stopAndWait(runnerDeviceId);
  }

  async restart(runnerDeviceId: string): Promise<void> {
    await this.stopAndWait(runnerDeviceId);
    await this.startAndWait(runnerDeviceId);
  }

  async uninstall(runnerDeviceId: string): Promise<void> {
    const serviceName = runnerWindowsServiceName(runnerDeviceId);
    const state = await this.status(runnerDeviceId);
    if (state === 'running') await this.stopAndWait(runnerDeviceId);
    if (state !== 'not_installed') {
      await this.invoke(this.scExecutable, ['delete', serviceName]);
      await this.waitForState(runnerDeviceId, 'not_installed');
    }
    const instanceDirectory = join(this.serviceDirectory, serviceName);
    const resolvedInstance = resolve(instanceDirectory);
    const resolvedRoot = `${resolve(this.serviceDirectory)}\\`;
    if (!resolvedInstance.startsWith(resolvedRoot)) {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_CONFIGURATION_INVALID',
      );
    }
    await rm(resolvedInstance, { recursive: true, force: true });
  }

  async status(runnerDeviceId: string): Promise<WindowsRunnerServiceState> {
    const serviceName = runnerWindowsServiceName(runnerDeviceId);
    const result = await this.commandRunner.run(this.scExecutable, [
      'query',
      serviceName,
    ]);
    if (result.code === 1060 || result.output.includes('1060')) {
      return 'not_installed';
    }
    if (result.code !== 0) return 'unknown';
    if (/STATE\s*:\s*4\s+RUNNING/i.test(result.output)) return 'running';
    if (/STATE\s*:\s*1\s+STOPPED/i.test(result.output)) return 'stopped';
    return 'unknown';
  }

  async currentBinaryPath(runnerDeviceId: string): Promise<string | null> {
    const serviceName = runnerWindowsServiceName(runnerDeviceId);
    const query = await this.commandRunner.run(this.scExecutable, [
      'qc',
      serviceName,
    ]);
    if (query.code === 1060 || query.output.includes('1060')) return null;
    if (query.code !== 0) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
    }
    const match = /^\s*BINARY_PATH_NAME\s*:\s*(.+?)\s*$/im.exec(query.output);
    if (match?.[1] === undefined) {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_CONFIGURATION_INVALID',
      );
    }
    return parseWindowsServiceBinaryPath(match[1]);
  }

  async stopAndWait(
    runnerDeviceId: string,
    timeoutMilliseconds = SERVICE_OPERATION_TIMEOUT_MS,
  ): Promise<void> {
    validateWaitTimeout(timeoutMilliseconds);
    const state = await this.status(runnerDeviceId);
    if (state === 'stopped') return;
    if (state !== 'running') {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
    }
    await this.invoke(this.scExecutable, [
      'stop',
      runnerWindowsServiceName(runnerDeviceId),
    ]);
    await this.waitForState(runnerDeviceId, 'stopped', timeoutMilliseconds);
  }

  async startAndWait(
    runnerDeviceId: string,
    timeoutMilliseconds = SERVICE_OPERATION_TIMEOUT_MS,
    activationProof?: WindowsRunnerServiceActivationProof,
  ): Promise<void> {
    validateWaitTimeout(timeoutMilliseconds);
    const state = await this.status(runnerDeviceId);
    const serviceExecutable = await this.currentBinaryPath(runnerDeviceId);
    if (serviceExecutable === null) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
    }
    if (activationProof === undefined) {
      await assertVerifiedServiceExecutable(serviceExecutable);
    } else {
      await assertActivationProof(activationProof, serviceExecutable);
    }
    if (state === 'running') return;
    if (state !== 'stopped') {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
    }
    await this.invoke(this.scExecutable, [
      'start',
      runnerWindowsServiceName(runnerDeviceId),
    ]);
    await this.waitForState(runnerDeviceId, 'running', timeoutMilliseconds);
  }

  async rebindBinaryPath(input: {
    readonly runnerDeviceId: string;
    readonly expectedSourcePath: string;
    readonly targetPath: string;
    readonly activationProof?: WindowsRunnerServiceActivationProof;
  }): Promise<void> {
    const expectedSourcePath = validatedAbsolutePath(input.expectedSourcePath);
    const targetPath = validatedAbsolutePath(input.targetPath);
    if ((await this.status(input.runnerDeviceId)) !== 'stopped') {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
    }
    if (
      !sameWindowsPath(
        (await this.currentBinaryPath(input.runnerDeviceId)) ?? '',
        expectedSourcePath,
      )
    ) {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_CONFIGURATION_INVALID',
      );
    }
    if (input.activationProof === undefined) {
      await assertVerifiedServiceExecutable(targetPath);
    } else {
      await assertActivationProof(input.activationProof, targetPath);
    }
    await this.invoke(this.scExecutable, [
      'config',
      runnerWindowsServiceName(input.runnerDeviceId),
      'binPath=',
      `"${targetPath}"`,
    ]);
    if (
      !sameWindowsPath(
        (await this.currentBinaryPath(input.runnerDeviceId)) ?? '',
        targetPath,
      )
    ) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
    }
  }

  async verifyRunning(
    config: WindowsRunnerServiceConfig,
    expectedBinaryPath?: string,
  ): Promise<boolean> {
    const parsed = WindowsRunnerServiceConfigSchema.safeParse(config);
    if (!parsed.success) return false;
    const state = await this.status(parsed.data.runnerDeviceId);
    if (state !== 'running') return false;
    const query = await this.commandRunner.run(this.scExecutable, [
      'qc',
      parsed.data.serviceName,
    ]);
    if (
      query.code !== 0 ||
      !/START_TYPE\s*:\s*2\s+AUTO_START/i.test(query.output)
    ) {
      return false;
    }
    const requiredBinary =
      expectedBinaryPath ?? this.initialActivationExecutable(parsed.data);
    try {
      const currentBinary = await this.currentBinaryPath(
        parsed.data.runnerDeviceId,
      );
      if (!sameWindowsPath(currentBinary ?? '', requiredBinary)) return false;
      await assertVerifiedServiceExecutable(requiredBinary);
      return true;
    } catch {
      return false;
    }
  }

  configPath(runnerDeviceId: string): string {
    return join(
      this.serviceDirectory,
      runnerWindowsServiceName(runnerDeviceId),
      'runner-service.v1.json',
    );
  }

  async loadConfig(path: string): Promise<WindowsRunnerServiceConfig> {
    try {
      const config = await readWindowsRunnerServiceConfig(path);
      if (
        !sameWindowsPath(config.runnerEntryPoint, this.runnerEntryPoint) ||
        !sameWindowsPath(config.dataRoot, this.dataRoot)
      ) {
        throw new Error('binding');
      }
      return config;
    } catch {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_CONFIGURATION_INVALID',
      );
    }
  }

  private buildConfig(runnerDeviceId: string): WindowsRunnerServiceConfig {
    return WindowsRunnerServiceConfigSchema.parse({
      schemaVersion: 1,
      serviceName: runnerWindowsServiceName(runnerDeviceId),
      runnerDeviceId,
      dataRoot: this.dataRoot,
      nodeExecutable: process.execPath,
      runnerEntryPoint: this.runnerEntryPoint,
    });
  }

  private initialActivationExecutable(
    config: WindowsRunnerServiceConfig,
  ): string {
    return join(
      this.serviceDirectory,
      config.serviceName,
      'current',
      `${config.serviceName}.exe`,
    );
  }

  private async verifyWrapper(): Promise<void> {
    try {
      await access(this.wrapperPath);
      const digest = createHash('sha256')
        .update(await readFile(this.wrapperPath))
        .digest('hex');
      if (digest !== WIN_SW_SHA256) throw new Error('digest');
    } catch {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_MANAGER_UNAVAILABLE');
    }
  }

  private async invoke(
    executable: string,
    args: readonly string[],
  ): Promise<void> {
    const result = await this.commandRunner.run(executable, args);
    if (result.code !== 0) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
    }
  }

  private async waitForState(
    runnerDeviceId: string,
    expected: WindowsRunnerServiceState,
    timeoutMilliseconds = SERVICE_OPERATION_TIMEOUT_MS,
  ): Promise<void> {
    validateWaitTimeout(timeoutMilliseconds);
    const deadline = Date.now() + timeoutMilliseconds;
    do {
      if ((await this.status(runnerDeviceId)) === expected) return;
      await this.sleep(SERVICE_STATE_POLL_INTERVAL_MS);
    } while (Date.now() <= deadline);
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
  }
}

export function parseWindowsServiceBinaryPath(value: string): string {
  const trimmed = value.trim();
  let candidate: string;
  if (trimmed.startsWith('"')) {
    const closingQuote = trimmed.indexOf('"', 1);
    if (closingQuote < 2 || trimmed.slice(closingQuote + 1).trim() !== '') {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_CONFIGURATION_INVALID',
      );
    }
    candidate = trimmed.slice(1, closingQuote);
  } else {
    candidate = trimmed;
  }
  if (!win32.isAbsolute(candidate) || candidate.includes('\0')) {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
  return win32.normalize(candidate);
}

export function buildWindowsServiceXml(
  config: WindowsRunnerServiceConfig,
  configPath: string,
  logDirectory = join(dirname(configPath), 'logs'),
  activationConfigPath?: string,
): string {
  const argumentsValue = [
    config.runnerEntryPoint,
    'service-run',
    '--service-config',
    configPath,
    ...(activationConfigPath === undefined
      ? []
      : ['--service-activation', activationConfigPath]),
  ]
    .map(quoteWindowsArgument)
    .join(' ');
  return `<?xml version="1.0" encoding="utf-8"?>
<service>
  <id>${escapeXml(config.serviceName)}</id>
  <name>TaskTwin Local Runner</name>
  <description>TaskTwin Local Runner background execution service.</description>
  <executable>${escapeXml(config.nodeExecutable)}</executable>
  <arguments>${escapeXml(argumentsValue)}</arguments>
  <workingdirectory>${escapeXml(dirname(config.runnerEntryPoint))}</workingdirectory>
  <serviceaccount><username>NT AUTHORITY\\LocalService</username></serviceaccount>
  <startmode>Automatic</startmode>
  <hidewindow>true</hidewindow>
  <stoptimeout>90sec</stoptimeout>
  <preshutdown>true</preshutdown>
  <preshutdownTimeout>3 min</preshutdownTimeout>
  <onfailure action="restart" delay="10 sec" />
  <resetfailure>1 hour</resetfailure>
  <logpath>${escapeXml(logDirectory)}</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>4</keepFiles></log>
</service>
`;
}

function validatedAbsolutePath(value: string): string {
  if (!isAbsolute(value) || value.includes('\0')) {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
  return resolve(value);
}

function sameWindowsPath(left: string, right: string): boolean {
  if (left === '' || right === '') return false;
  return (
    win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase()
  );
}

function quoteWindowsArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function readStrictConfiguration<Value>(
  path: string,
  schema: { parse(value: unknown): Value },
): Promise<Value> {
  try {
    const resolved = validatedAbsolutePath(path);
    const stat = await lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) {
      throw new Error('type');
    }
    return schema.parse(
      JSON.parse(await readFile(resolved, 'utf8')) as unknown,
    );
  } catch {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
}

async function assertVerifiedServiceExecutable(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('type');
    const digest = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    if (digest !== WIN_SW_SHA256) throw new Error('digest');
  } catch {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
}

async function assertActivationProof(
  proof: WindowsRunnerServiceActivationProof,
  expectedExecutablePath: string,
): Promise<void> {
  try {
    if (
      !sameWindowsPath(proof.serviceExecutablePath, expectedExecutablePath) ||
      proof.serviceExecutableSha256 !== WIN_SW_SHA256 ||
      !sameWindowsPath(
        dirname(proof.activationConfigPath),
        dirname(proof.serviceExecutablePath),
      ) ||
      !sameWindowsPath(
        dirname(proof.serviceConfigPath),
        dirname(proof.serviceExecutablePath),
      ) ||
      !sameWindowsPath(
        dirname(proof.serviceXmlPath),
        dirname(proof.serviceExecutablePath),
      )
    ) {
      throw new Error('binding');
    }
    const actual = await Promise.all([
      sha256RegularFile(proof.activationConfigPath, 16 * 1024),
      sha256RegularFile(proof.serviceConfigPath, 16 * 1024),
      sha256RegularFile(proof.serviceXmlPath, 64 * 1024),
      sha256RegularFile(proof.serviceExecutablePath, 128 * 1024 * 1024),
      ...proof.criticalRuntimeFiles.map((file) =>
        sha256RegularFile(file.path, 256 * 1024 * 1024),
      ),
    ]);
    if (
      actual[0] !== proof.activationConfigSha256 ||
      actual[1] !== proof.serviceConfigSha256 ||
      actual[2] !== proof.serviceXmlSha256 ||
      actual[3] !== proof.serviceExecutableSha256 ||
      proof.criticalRuntimeFiles.length !== 3 ||
      proof.criticalRuntimeFiles.some(
        (file, index) => actual[index + 4] !== file.sha256,
      )
    ) {
      throw new Error('digest');
    }
  } catch {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
}

async function assertExactRegularFile(
  path: string,
  expected: string,
  maximumBytes: number,
): Promise<void> {
  try {
    const contents = await readRegularFile(path, maximumBytes);
    if (!contents.equals(Buffer.from(expected, 'utf8'))) {
      throw new Error('contents');
    }
  } catch {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
}

async function sha256RegularFile(
  path: string,
  maximumBytes: number,
): Promise<string> {
  return createHash('sha256')
    .update(await readRegularFile(path, maximumBytes))
    .digest('hex');
}

async function readRegularFile(
  path: string,
  maximumBytes: number,
): Promise<Buffer> {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > maximumBytes
  ) {
    throw new Error('type');
  }
  return readFile(path);
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function copyVerifiedWrapper(
  source: string,
  destination: string,
  replace: boolean,
): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    if (!replace && (await lstat(destination).catch(() => null)) !== null) {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_CONFIGURATION_INVALID',
      );
    }
    await copyFile(source, temporary, fsConstants.COPYFILE_EXCL);
    const digest = createHash('sha256')
      .update(await readFile(temporary))
      .digest('hex');
    if (digest !== WIN_SW_SHA256) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_MANAGER_UNAVAILABLE');
    }
    await chmod(temporary, 0o700).catch(() => undefined);
    await syncFile(temporary);
    await rename(temporary, destination);
    await syncDirectoryBestEffort(dirname(destination));
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeAtomic(
  path: string,
  contents: string,
  replace: boolean,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    if (!replace && (await lstat(path).catch(() => null)) !== null) {
      throw new RunnerServiceRuntimeError(
        'RUNNER_SERVICE_CONFIGURATION_INVALID',
      );
    }
    await writeFile(temporary, contents, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(temporary, 0o600).catch(() => undefined);
    await syncFile(temporary);
    await rename(temporary, path);
    await syncDirectoryBestEffort(dirname(path));
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryBestEffort(path: string): Promise<void> {
  const handle = await open(path, 'r').catch(() => null);
  if (handle === null) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function validateWaitTimeout(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < MIN_SERVICE_WAIT_TIMEOUT_MS ||
    value > MAX_SERVICE_WAIT_TIMEOUT_MS
  ) {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
}

function invokeAllowFailure(
  executable: string,
  args: readonly string[],
): Promise<WindowsServiceCommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      operation();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() =>
        reject(
          new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED'),
        ),
      );
    }, SERVICE_OPERATION_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size <= MAX_PROCESS_OUTPUT_BYTES) chunks.push(chunk);
    });
    child.once('error', () =>
      finish(() =>
        reject(
          new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED'),
        ),
      ),
    );
    child.once('close', (code) =>
      finish(() =>
        resolveResult({
          code: code ?? -1,
          output:
            size > MAX_PROCESS_OUTPUT_BYTES
              ? ''
              : Buffer.concat(chunks).toString('utf8'),
        }),
      ),
    );
  });
}
