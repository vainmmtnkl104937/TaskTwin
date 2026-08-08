import { createHash } from 'node:crypto';
import { access, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { RunnerServiceRuntimeError } from '@tasktwin/runner-service-runtime';
import { z } from 'zod';

import { runnerWindowsServiceName } from './windows-service-identity.js';

const WIN_SW_SHA256 = 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f';
const MAX_PROCESS_OUTPUT_BYTES = 32 * 1024;
const SERVICE_OPERATION_TIMEOUT_MS = 180_000;

export const WindowsRunnerServiceConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  serviceName: z.string().regex(/^TaskTwinRunner_[0-9a-f]{32}$/),
  runnerDeviceId: z.string().uuid(),
  dataRoot: z.string().min(3).max(1_024),
  nodeExecutable: z.string().min(3).max(1_024),
  runnerEntryPoint: z.string().min(3).max(1_024),
}).superRefine((value, context) => {
  if (value.serviceName !== runnerWindowsServiceName(value.runnerDeviceId)) {
    context.addIssue({
      code: 'custom',
      path: ['serviceName'],
      message: 'The service name does not match the Runner identity.',
    });
  }
});

export type WindowsRunnerServiceConfig = z.infer<typeof WindowsRunnerServiceConfigSchema>;
export type WindowsRunnerServiceState = 'not_installed' | 'stopped' | 'running' | 'unknown';

export async function readWindowsRunnerServiceConfig(
  path: string,
): Promise<WindowsRunnerServiceConfig> {
  try {
    const resolved = validatedAbsolutePath(path);
    const stat = await lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) {
      throw new Error('type');
    }
    return WindowsRunnerServiceConfigSchema.parse(
      JSON.parse(await readFile(resolved, 'utf8')) as unknown,
    );
  } catch {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
}

export class WindowsRunnerServiceManager {
  readonly serviceDirectory: string;
  readonly wrapperPath: string;

  constructor(
    private readonly runnerEntryPoint: string,
    private readonly dataRoot: string,
    programData = process.env['ProgramData'],
  ) {
    if (process.platform !== 'win32' || programData === undefined) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_PLATFORM_UNSUPPORTED');
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
  }

  async install(runnerDeviceId: string): Promise<void> {
    await this.verifyWrapper();
    const config = this.buildConfig(runnerDeviceId);
    const instanceDirectory = join(this.serviceDirectory, config.serviceName);
    await mkdir(instanceDirectory, { recursive: true, mode: 0o700 });
    const configPath = join(instanceDirectory, 'runner-service.v1.json');
    const xmlPath = join(instanceDirectory, 'runner-service.xml');
    await writeAtomic(configPath, `${JSON.stringify(config)}\n`);
    await writeAtomic(xmlPath, buildWindowsServiceXml(config, configPath));
    await invoke(this.wrapperPath, ['install', xmlPath]);
    await invoke('sc.exe', ['sidtype', config.serviceName, 'unrestricted']);
    await invoke('icacls.exe', [
      join(this.dataRoot, '.tasktwin'),
      '/grant',
      `NT SERVICE\\${config.serviceName}:(OI)(CI)M`,
      '/T',
      '/C',
    ]);
  }

  async start(runnerDeviceId: string): Promise<void> {
    await this.invokeWrapper(runnerDeviceId, 'start');
  }

  async stop(runnerDeviceId: string): Promise<void> {
    await this.invokeWrapper(runnerDeviceId, 'stop');
  }

  async restart(runnerDeviceId: string): Promise<void> {
    await this.invokeWrapper(runnerDeviceId, 'restart');
  }

  async uninstall(runnerDeviceId: string): Promise<void> {
    await this.invokeWrapper(runnerDeviceId, 'uninstall');
    const instanceDirectory = join(
      this.serviceDirectory,
      runnerWindowsServiceName(runnerDeviceId),
    );
    const resolvedInstance = resolve(instanceDirectory);
    const resolvedRoot = `${resolve(this.serviceDirectory)}\\`;
    if (!resolvedInstance.startsWith(resolvedRoot)) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
    }
    await rm(resolvedInstance, { recursive: true, force: true });
  }

  async status(runnerDeviceId: string): Promise<WindowsRunnerServiceState> {
    const config = this.buildConfig(runnerDeviceId);
    const result = await invokeAllowFailure('sc.exe', ['query', config.serviceName]);
    if (result.code === 1060 || result.output.includes('1060')) return 'not_installed';
    if (result.code !== 0) return 'unknown';
    if (/STATE\s*:\s*4\s+RUNNING/i.test(result.output)) return 'running';
    if (/STATE\s*:\s*1\s+STOPPED/i.test(result.output)) return 'stopped';
    return 'unknown';
  }

  async verifyRunning(config: WindowsRunnerServiceConfig): Promise<boolean> {
    const parsed = WindowsRunnerServiceConfigSchema.safeParse(config);
    if (!parsed.success) return false;
    const state = await this.status(parsed.data.runnerDeviceId);
    if (state !== 'running') return false;
    const query = await invokeAllowFailure('sc.exe', ['qc', parsed.data.serviceName]);
    return query.code === 0 && /START_TYPE\s*:\s*2\s+AUTO_START/i.test(query.output);
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
        resolve(config.runnerEntryPoint) !== this.runnerEntryPoint ||
        resolve(config.dataRoot) !== this.dataRoot
      ) {
        throw new Error('binding');
      }
      return config;
    } catch {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
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

  private async invokeWrapper(
    runnerDeviceId: string,
    command: 'start' | 'stop' | 'restart' | 'uninstall',
  ): Promise<void> {
    await this.verifyWrapper();
    const xmlPath = join(
      this.serviceDirectory,
      runnerWindowsServiceName(runnerDeviceId),
      'runner-service.xml',
    );
    await invoke(this.wrapperPath, [command, xmlPath]);
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
}

function validatedAbsolutePath(value: string): string {
  if (!isAbsolute(value) || value.includes('\0')) {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
  }
  return resolve(value);
}

export function buildWindowsServiceXml(
  config: WindowsRunnerServiceConfig,
  configPath: string,
): string {
  const argumentsValue = [
    config.runnerEntryPoint,
    'service-run',
    '--service-config',
    configPath,
  ].map(quoteWindowsArgument).join(' ');
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
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>4</keepFiles></log>
</service>
`;
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

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
}

async function invoke(executable: string, args: readonly string[]): Promise<void> {
  const result = await invokeAllowFailure(executable, args);
  if (result.code !== 0) {
    throw new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED');
  }
}

function invokeAllowFailure(
  executable: string,
  args: readonly string[],
): Promise<{ code: number; output: string }> {
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
        reject(new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED')),
      );
    }, SERVICE_OPERATION_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size <= MAX_PROCESS_OUTPUT_BYTES) chunks.push(chunk);
    });
    child.once('error', () =>
      finish(() =>
        reject(new RunnerServiceRuntimeError('RUNNER_SERVICE_OPERATION_FAILED')),
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
