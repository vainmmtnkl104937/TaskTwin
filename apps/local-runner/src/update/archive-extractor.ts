import { spawn } from 'node:child_process';
import { access, lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

const ArchiveOperationResultSchema = z.strictObject({
  ok: z.literal(true),
  fileCount: z.number().int().positive().max(10_000),
  totalBytes: z
    .number()
    .int()
    .nonnegative()
    .max(4 * 1024 * 1024 * 1024),
  rootDirectoryName: z
    .string()
    .regex(/^tasktwin-runner-.+-windows-x64$/)
    .max(255),
});

export type ArchiveOperationResult = z.infer<
  typeof ArchiveOperationResultSchema
>;

const MAXIMUM_OUTPUT_BYTES = 64 * 1024;
const ARCHIVE_OPERATION_TIMEOUT_MS = 15 * 60 * 1_000;

export class WindowsReleaseArchiveExtractor {
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
    this.powershellExecutable = windowsPowerShellExecutable(
      dependencies.systemRoot ?? process.env['SystemRoot'] ?? 'C:\\Windows',
    );
  }

  async available(): Promise<boolean> {
    if (this.platform !== 'win32') return false;
    return access(this.scriptPath).then(
      () => true,
      () => false,
    );
  }

  extract(
    artifactPath: string,
    destinationPath: string,
  ): Promise<ArchiveOperationResult> {
    return this.invoke('extract', artifactPath, destinationPath);
  }

  compare(
    artifactPath: string,
    destinationPath: string,
  ): Promise<ArchiveOperationResult> {
    return this.invoke('compare', artifactPath, destinationPath);
  }

  private async invoke(
    operation: 'extract' | 'compare',
    artifactPath: string,
    destinationPath: string,
  ): Promise<ArchiveOperationResult> {
    if (
      this.platform !== 'win32' ||
      !isAbsolute(artifactPath) ||
      !isAbsolute(destinationPath) ||
      artifactPath.includes('\0') ||
      destinationPath.includes('\0')
    ) {
      throw new Error('The Windows release archive operation is invalid.');
    }
    const script = await lstat(this.scriptPath);
    if (!script.isFile() || script.isSymbolicLink()) {
      throw new Error('The Windows release archive tool is unavailable.');
    }
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.powershellExecutable,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this.scriptPath,
          '-Operation',
          operation,
          '-Artifact',
          artifactPath,
          '-Destination',
          destinationPath,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const chunks: Buffer[] = [];
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
          reject(new Error('The release archive operation timed out.')),
        );
      }, ARCHIVE_OPERATION_TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes <= MAXIMUM_OUTPUT_BYTES) chunks.push(chunk);
      });
      child.once('error', () =>
        finish(() =>
          reject(new Error('The release archive operation failed.')),
        ),
      );
      child.once('close', (code) => {
        if (code !== 0 || outputBytes > MAXIMUM_OUTPUT_BYTES) {
          finish(() =>
            reject(new Error('The release archive operation failed safely.')),
          );
          return;
        }
        try {
          const result = ArchiveOperationResultSchema.parse(
            JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
          );
          finish(() => resolve(result));
        } catch {
          finish(() =>
            reject(new Error('The release archive result is invalid.')),
          );
        }
      });
    });
  }
}

export function windowsPowerShellExecutable(systemRoot: string): string {
  if (!isAbsolute(systemRoot) || systemRoot.includes('\0')) {
    throw new Error('The Windows system root is invalid.');
  }
  return join(
    resolve(systemRoot),
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}
