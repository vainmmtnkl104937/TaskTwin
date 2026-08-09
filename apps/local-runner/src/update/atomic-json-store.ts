import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  assertControlledDirectoryChain,
  ensureControlledDirectory,
  validateExistingControlledDirectoryChain,
} from './controlled-directory.js';

interface StrictSchema<Value> {
  parse(value: unknown): Value;
}

const DEFAULT_MAXIMUM_BYTES = 256 * 1024;

export class AtomicJsonStore<Value> {
  constructor(
    readonly path: string,
    private readonly schema: StrictSchema<Value>,
    private readonly maximumBytes = DEFAULT_MAXIMUM_BYTES,
  ) {}

  async read(): Promise<Value | null> {
    if (!(await validateExistingControlledDirectoryChain(dirname(this.path)))) {
      return null;
    }
    const stat = await lstat(this.path).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (stat === null) return null;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > this.maximumBytes
    ) {
      throw new Error('The local Runner update record is invalid.');
    }
    try {
      return this.schema.parse(
        JSON.parse(await readFile(this.path, 'utf8')) as unknown,
      );
    } catch {
      throw new Error('The local Runner update record is invalid.');
    }
  }

  async replace(value: Value): Promise<void> {
    await this.write(value, false);
  }

  async create(value: Value): Promise<void> {
    await this.write(value, true);
  }

  private async write(value: Value, createOnly: boolean): Promise<void> {
    const parsed = this.schema.parse(value);
    const directory = dirname(this.path);
    await ensureControlledDirectory(directory);
    const existing = await lstatOrNull(this.path);
    if (
      existing !== null &&
      (!existing.isFile() || existing.isSymbolicLink())
    ) {
      throw new Error('The local Runner update record is invalid.');
    }
    if (createOnly && existing !== null) {
      throw new Error('The immutable Runner update record already exists.');
    }
    const temporaryPath = join(
      directory,
      `.${this.path.split(/[\\/]/).at(-1) ?? 'record'}.${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(parsed)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      const candidate = this.schema.parse(
        JSON.parse(await readFile(temporaryPath, 'utf8')) as unknown,
      );
      void candidate;
      await assertControlledDirectoryChain(directory);
      const finalExisting = await lstatOrNull(this.path);
      if (
        finalExisting !== null &&
        (!finalExisting.isFile() || finalExisting.isSymbolicLink())
      ) {
        throw new Error('The local Runner update record is invalid.');
      }
      if (createOnly && finalExisting !== null) {
        throw new Error('The immutable Runner update record already exists.');
      }
      await rename(temporaryPath, this.path);
      await syncDirectoryBestEffort(directory);
    } catch (error: unknown) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  const handle = await open(directory, 'r').catch(() => null);
  if (handle === null) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function lstatOrNull(path: string) {
  return lstat(path).catch((error: unknown) =>
    isMissing(error) ? null : Promise.reject(error),
  );
}
