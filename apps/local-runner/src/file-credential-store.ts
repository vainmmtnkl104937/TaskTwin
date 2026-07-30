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

import {
  StoredRunnerCredentialSchema,
  type StoredRunnerCredential,
} from '@tasktwin/runner-protocol';

import {
  CredentialStoreError,
  type RunnerCredentialStore,
} from './credential-store.js';

const MAX_CREDENTIAL_FILE_BYTES = 16 * 1024;

export class FileCredentialStore implements RunnerCredentialStore {
  private readonly directoryPath: string;
  private readonly filePath: string;

  constructor(rootDirectory = homedir()) {
    this.directoryPath = join(rootDirectory, '.tasktwin');
    this.filePath = join(this.directoryPath, 'runner-credential.json');
  }

  async load(): Promise<StoredRunnerCredential | null> {
    try {
      const file = await lstat(this.filePath).catch((error: unknown) => {
        if (isMissingFile(error)) {
          return null;
        }
        throw error;
      });
      if (file === null) {
        return null;
      }
      if (
        !file.isFile() ||
        file.isSymbolicLink() ||
        file.size > MAX_CREDENTIAL_FILE_BYTES
      ) {
        throw new CredentialStoreError();
      }
      const parsed = StoredRunnerCredentialSchema.safeParse(
        JSON.parse(await readFile(this.filePath, 'utf8')) as unknown,
      );
      if (!parsed.success) {
        throw new CredentialStoreError();
      }
      return parsed.data;
    } catch (error: unknown) {
      if (error instanceof CredentialStoreError) {
        throw error;
      }
      throw new CredentialStoreError();
    }
  }

  async save(value: StoredRunnerCredential): Promise<void> {
    const parsed = StoredRunnerCredentialSchema.safeParse(value);
    if (!parsed.success) {
      throw new CredentialStoreError();
    }
    const temporaryPath = join(
      this.directoryPath,
      `.runner-credential.${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      await mkdir(this.directoryPath, { recursive: true, mode: 0o700 });
      await chmod(this.directoryPath, 0o700);
      const existing = await lstat(this.filePath).catch((error: unknown) => {
        if (isMissingFile(error)) {
          return null;
        }
        throw error;
      });
      if (
        existing !== null &&
        (!existing.isFile() || existing.isSymbolicLink())
      ) {
        throw new CredentialStoreError();
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
      if (error instanceof CredentialStoreError) {
        throw error;
      }
      throw new CredentialStoreError();
    }
  }

  async clear(): Promise<void> {
    try {
      const existing = await lstat(this.filePath).catch((error: unknown) => {
        if (isMissingFile(error)) {
          return null;
        }
        throw error;
      });
      if (existing === null) {
        return;
      }
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new CredentialStoreError();
      }
      await unlink(this.filePath);
    } catch (error: unknown) {
      if (error instanceof CredentialStoreError) {
        throw error;
      }
      throw new CredentialStoreError();
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
