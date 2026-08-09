import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';

import { LocalSecretStoreError } from '@tasktwin/local-secret-store';

import type { WindowsNativeProtectionBridge } from './windows-native-master-key-protector.js';

const MAX_BRIDGE_OUTPUT_BYTES = 128 * 1024;
const NATIVE_BRIDGE_TIMEOUT_MS = 30_000;

export class PowerShellWindowsNativeProtectionBridge
  implements WindowsNativeProtectionBridge {
  private readonly platform: NodeJS.Platform;
  private readonly powershellExecutable: string;

  constructor(
    private readonly scriptPath: string,
    dependencies: {
      readonly platform?: NodeJS.Platform;
      readonly systemRoot?: string;
    } = {},
  ) {
    this.platform = dependencies.platform ?? process.platform;
    this.powershellExecutable = nativeBridgePowerShellExecutable(
      dependencies.systemRoot ?? process.env['SystemRoot'] ?? 'C:\\Windows',
    );
  }

  async available(): Promise<boolean> {
    if (this.platform !== 'win32') return false;
    return access(this.scriptPath).then(() => true, () => false);
  }

  protect(input: Uint8Array, descriptor: string): Promise<Uint8Array> {
    return this.invoke({ operation: 'protect', data: input, descriptor });
  }

  unprotect(input: Uint8Array): Promise<Uint8Array> {
    return this.invoke({ operation: 'unprotect', data: input });
  }

  private invoke(input: {
    operation: 'protect' | 'unprotect';
    data: Uint8Array;
    descriptor?: string;
  }): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.powershellExecutable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
      );
      const output: Buffer[] = [];
      let outputBytes = 0;
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
          reject(new LocalSecretStoreError('NATIVE_PROTECTOR_FAILED')),
        );
      }, NATIVE_BRIDGE_TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes <= MAX_BRIDGE_OUTPUT_BYTES) output.push(chunk);
      });
      child.once('error', () =>
        finish(() =>
          reject(new LocalSecretStoreError('NATIVE_PROTECTOR_FAILED')),
        ),
      );
      child.once('close', (code) => {
        if (code !== 0 || outputBytes > MAX_BRIDGE_OUTPUT_BYTES) {
          finish(() =>
            reject(new LocalSecretStoreError('NATIVE_PROTECTOR_FAILED')),
          );
          return;
        }
        try {
          const parsed = JSON.parse(Buffer.concat(output).toString('utf8')) as unknown;
          if (
            typeof parsed !== 'object' || parsed === null ||
            !('ok' in parsed) || parsed.ok !== true ||
            !('data' in parsed) || typeof parsed.data !== 'string' ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.data)
          ) {
            throw new Error('Invalid bridge response.');
          }
          const data = parsed.data;
          finish(() => resolve(Buffer.from(data, 'base64')));
        } catch {
          finish(() =>
            reject(new LocalSecretStoreError('NATIVE_PROTECTOR_FAILED')),
          );
        }
      });
      const request = JSON.stringify({
        operation: input.operation,
        data: Buffer.from(input.data).toString('base64'),
        ...(input.descriptor === undefined ? {} : { descriptor: input.descriptor }),
      });
      child.stdin.end(request, 'utf8');
    });
  }
}

export function nativeBridgePowerShellExecutable(systemRoot: string): string {
  if (!isAbsolute(systemRoot) || systemRoot.includes('\0')) {
    throw new LocalSecretStoreError('NATIVE_PROTECTOR_UNAVAILABLE');
  }
  return join(
    resolve(systemRoot),
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}
