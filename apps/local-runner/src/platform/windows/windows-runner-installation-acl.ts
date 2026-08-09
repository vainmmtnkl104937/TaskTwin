import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { runnerWindowsServiceName } from './windows-service-identity.js';

const MAXIMUM_OUTPUT_BYTES = 4 * 1024;
const ACL_OPERATION_TIMEOUT_MS = 3 * 60_000;
const SUCCESS_OUTPUT = 'TASKTWIN_RUNNER_INSTALLATION_ACL_OK';

export interface RunnerInstallationSecurityBoundary {
  protectAndValidate(): Promise<void>;
  validate(): Promise<void>;
}

export interface WindowsAclCommandResult {
  readonly code: number;
  readonly output: string;
}

export interface WindowsAclCommandRunner {
  run(
    executable: string,
    args: readonly string[],
  ): Promise<WindowsAclCommandResult>;
}

export class WindowsRunnerInstallationAclBoundary implements RunnerInstallationSecurityBoundary {
  readonly serviceSid: string;
  private readonly root: string;
  private readonly scriptPath: string;
  private readonly powershellPath: string;
  private readonly commandRunner: WindowsAclCommandRunner;

  constructor(input: {
    readonly root: string;
    readonly runnerDeviceId: string;
    readonly scriptPath: string;
    readonly systemRoot?: string;
    readonly platform?: NodeJS.Platform;
    readonly commandRunner?: WindowsAclCommandRunner;
  }) {
    if ((input.platform ?? process.platform) !== 'win32') {
      throw new Error(
        'Runner installation ACLs are supported only on Windows.',
      );
    }
    this.root = requireInstallationRoot(input.root, input.runnerDeviceId);
    this.scriptPath = requireAbsolutePath(input.scriptPath);
    const systemRoot = input.systemRoot ?? process.env['SystemRoot'];
    if (systemRoot === undefined) {
      throw new Error('The Windows system root is unavailable.');
    }
    this.powershellPath = join(
      requireAbsolutePath(systemRoot),
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    this.serviceSid = windowsServiceSid(
      runnerWindowsServiceName(input.runnerDeviceId),
    );
    this.commandRunner = input.commandRunner ?? { run: invokeAclAdapter };
  }

  protectAndValidate(): Promise<void> {
    return this.invoke('protect');
  }

  validate(): Promise<void> {
    return this.invoke('validate');
  }

  private async invoke(operation: 'protect' | 'validate'): Promise<void> {
    await assertRegularFile(this.scriptPath);
    const result = await this.commandRunner.run(this.powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      this.scriptPath,
      '-Operation',
      operation,
      '-Root',
      this.root,
      '-ServiceSid',
      this.serviceSid,
    ]);
    if (result.code !== 0 || result.output !== SUCCESS_OUTPUT) {
      throw new Error('The Runner installation ACL boundary is invalid.');
    }
  }
}

export function windowsServiceSid(serviceName: string): string {
  const digest = createHash('sha1')
    .update(Buffer.from(serviceName.toUpperCase(), 'utf16le'))
    .digest();
  const authorities = Array.from({ length: 5 }, (_, index) =>
    digest.readUInt32LE(index * 4),
  );
  return `S-1-5-80-${authorities.join('-')}`;
}

export function runnerInstallationRootFromActivationPath(
  activationConfigPath: string,
  runnerDeviceId: string,
): string {
  const configPath = requireAbsolutePath(activationConfigPath);
  if (
    basename(configPath).toLowerCase() !== 'runner-service-activation.v1.json'
  ) {
    throw new Error('The managed Runner activation path is invalid.');
  }
  const activation = dirname(configPath);
  const release = dirname(activation);
  const releases = dirname(release);
  const root = dirname(releases);
  if (
    basename(activation).toLowerCase() !== 'activation' ||
    basename(releases).toLowerCase() !== 'releases'
  ) {
    throw new Error('The managed Runner activation path is invalid.');
  }
  return requireInstallationRoot(root, runnerDeviceId);
}

function requireInstallationRoot(root: string, runnerDeviceId: string): string {
  const resolved = requireAbsolutePath(root);
  if (
    basename(resolved).toLowerCase() !== runnerDeviceId.toLowerCase() ||
    basename(dirname(resolved)).toLowerCase() !== 'runnerinstallations'
  ) {
    throw new Error('The Runner installation root is invalid.');
  }
  return resolved;
}

function requireAbsolutePath(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) {
    throw new Error('The Windows ACL path is invalid.');
  }
  return resolve(path);
}

async function assertRegularFile(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('The Windows ACL adapter is invalid.');
  }
}

function invokeAclAdapter(
  executable: string,
  args: readonly string[],
): Promise<WindowsAclCommandResult> {
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
      finish(() => reject(new Error('The Windows ACL operation timed out.')));
    }, ACL_OPERATION_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size <= MAXIMUM_OUTPUT_BYTES) chunks.push(chunk);
    });
    child.once('error', () =>
      finish(() => reject(new Error('The Windows ACL operation failed.'))),
    );
    child.once('close', (code) =>
      finish(() =>
        resolveResult({
          code: code ?? -1,
          output:
            size > MAXIMUM_OUTPUT_BYTES
              ? ''
              : Buffer.concat(chunks).toString('utf8'),
        }),
      ),
    );
  });
}
