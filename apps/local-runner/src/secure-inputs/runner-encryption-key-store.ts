import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { RunnerPublicKeyMetadataSchema } from '@tasktwin/secure-run-inputs';
import { z } from 'zod';

const MAX_KEY_FILE_BYTES = 16 * 1024;

export const StoredRunnerEncryptionKeySchema = z.strictObject({
  schemaVersion: z.literal(1),
  metadata: RunnerPublicKeyMetadataSchema,
  privateKeyFormat: z.literal('pkcs8'),
  privateKeyPkcs8: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(8 * 1024),
  createdAt: z.string().datetime({ offset: true }),
});

export type StoredRunnerEncryptionKey = z.infer<
  typeof StoredRunnerEncryptionKeySchema
>;

export interface RunnerEncryptionKeyStore {
  load(): Promise<StoredRunnerEncryptionKey | null>;
  save(value: StoredRunnerEncryptionKey): Promise<void>;
  clear(): Promise<void>;
}

export class RunnerEncryptionKeyStoreError extends Error {
  constructor() {
    super('The local Runner encryption key store is unavailable.');
    this.name = 'RunnerEncryptionKeyStoreError';
  }
}

export class InMemoryRunnerEncryptionKeyStore implements RunnerEncryptionKeyStore {
  private value: StoredRunnerEncryptionKey | null = null;

  async load(): Promise<StoredRunnerEncryptionKey | null> {
    return this.value === null ? null : structuredClone(this.value);
  }

  async save(value: StoredRunnerEncryptionKey): Promise<void> {
    const parsed = StoredRunnerEncryptionKeySchema.safeParse(value);
    if (!parsed.success) throw new RunnerEncryptionKeyStoreError();
    this.value = structuredClone(parsed.data);
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

export class FileRunnerEncryptionKeyStore implements RunnerEncryptionKeyStore {
  private readonly directoryPath: string;
  private readonly filePath: string;

  constructor(rootDirectory = homedir()) {
    this.directoryPath = join(rootDirectory, '.tasktwin');
    this.filePath = join(this.directoryPath, 'runner-encryption-key.json');
  }

  async load(): Promise<StoredRunnerEncryptionKey | null> {
    try {
      const file = await lstat(this.filePath).catch((error: unknown) =>
        isMissingFile(error) ? null : Promise.reject(error),
      );
      if (file === null) return null;
      if (
        !file.isFile() ||
        file.isSymbolicLink() ||
        file.size > MAX_KEY_FILE_BYTES
      ) {
        throw new RunnerEncryptionKeyStoreError();
      }
      const parsed = StoredRunnerEncryptionKeySchema.safeParse(
        JSON.parse(await readFile(this.filePath, 'utf8')) as unknown,
      );
      if (!parsed.success) throw new RunnerEncryptionKeyStoreError();
      return parsed.data;
    } catch (error: unknown) {
      if (error instanceof RunnerEncryptionKeyStoreError) throw error;
      throw new RunnerEncryptionKeyStoreError();
    }
  }

  async save(value: StoredRunnerEncryptionKey): Promise<void> {
    const parsed = StoredRunnerEncryptionKeySchema.safeParse(value);
    if (!parsed.success) throw new RunnerEncryptionKeyStoreError();
    const temporaryPath = join(
      this.directoryPath,
      `.runner-encryption-key.${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      await mkdir(this.directoryPath, { recursive: true, mode: 0o700 });
      await chmod(this.directoryPath, 0o700);
      const existing = await lstat(this.filePath).catch((error: unknown) =>
        isMissingFile(error) ? null : Promise.reject(error),
      );
      if (
        existing !== null &&
        (!existing.isFile() || existing.isSymbolicLink())
      ) {
        throw new RunnerEncryptionKeyStoreError();
      }
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(parsed.data)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch (error: unknown) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      if (error instanceof RunnerEncryptionKeyStoreError) throw error;
      throw new RunnerEncryptionKeyStoreError();
    }
  }

  async clear(): Promise<void> {
    try {
      const existing = await lstat(this.filePath).catch((error: unknown) =>
        isMissingFile(error) ? null : Promise.reject(error),
      );
      if (existing === null) return;
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new RunnerEncryptionKeyStoreError();
      }
      await unlink(this.filePath);
    } catch (error: unknown) {
      if (error instanceof RunnerEncryptionKeyStoreError) throw error;
      throw new RunnerEncryptionKeyStoreError();
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
