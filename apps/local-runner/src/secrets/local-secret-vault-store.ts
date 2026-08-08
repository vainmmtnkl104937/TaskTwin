import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  LocalSecretStoreError,
  LocalSecretVaultSchema,
  MAX_LOCAL_VAULT_FILE_BYTES,
  type LocalSecretVault,
} from '@tasktwin/local-secret-store';
import lockfile from 'proper-lockfile';

export interface LocalSecretVaultStore {
  load(): Promise<LocalSecretVault | null>;
  create(vault: LocalSecretVault): Promise<void>;
  replace(expectedRevision: number, vault: LocalSecretVault): Promise<void>;
  replaceVerified(
    expectedRevision: number,
    buildCandidate: (current: LocalSecretVault) => Promise<LocalSecretVault>,
    verifyCandidate: (candidate: LocalSecretVault) => Promise<void>,
  ): Promise<LocalSecretVault>;
}

export class FileLocalSecretVaultStore implements LocalSecretVaultStore {
  readonly directoryPath: string;
  readonly filePath: string;

  constructor(rootDirectory = homedir()) {
    this.directoryPath = join(rootDirectory, '.tasktwin');
    this.filePath = join(this.directoryPath, 'local-secret-vault.v1.json');
  }

  async load(): Promise<LocalSecretVault | null> {
    try {
      const stat = await lstat(this.filePath).catch((error: unknown) =>
        isMissing(error) ? null : Promise.reject(error),
      );
      if (stat === null) return null;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LOCAL_VAULT_FILE_BYTES) {
        throw new LocalSecretStoreError('VAULT_CORRUPTED');
      }
      const parsed = LocalSecretVaultSchema.safeParse(
        JSON.parse(await readFile(this.filePath, 'utf8')) as unknown,
      );
      if (!parsed.success) throw new LocalSecretStoreError('VAULT_CORRUPTED');
      return parsed.data;
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError) throw error;
      throw new LocalSecretStoreError('VAULT_UNAVAILABLE');
    }
  }

  async create(vault: LocalSecretVault): Promise<void> {
    await this.withLock(async () => {
      if (await this.load() !== null) {
        throw new LocalSecretStoreError('VAULT_ALREADY_INITIALIZED');
      }
      await this.writeAtomic(LocalSecretVaultSchema.parse(vault));
    });
  }

  async replace(expectedRevision: number, vault: LocalSecretVault): Promise<void> {
    await this.replaceVerified(
      expectedRevision,
      async () => vault,
      async () => undefined,
    );
  }

  async replaceVerified(
    expectedRevision: number,
    buildCandidate: (current: LocalSecretVault) => Promise<LocalSecretVault>,
    verifyCandidate: (candidate: LocalSecretVault) => Promise<void>,
  ): Promise<LocalSecretVault> {
    let committed: LocalSecretVault | null = null;
    await this.withLock(async () => {
      const current = await this.load();
      if (current === null) throw new LocalSecretStoreError('VAULT_NOT_INITIALIZED');
      const vault = LocalSecretVaultSchema.parse(await buildCandidate(current));
      if (current.revision !== expectedRevision || vault.revision !== expectedRevision + 1) {
        throw new LocalSecretStoreError('VAULT_REVISION_CONFLICT');
      }
      if (
        current.vaultId !== vault.vaultId ||
        current.workspaceId !== vault.workspaceId ||
        current.runnerDeviceId !== vault.runnerDeviceId
      ) {
        throw new LocalSecretStoreError('VAULT_BINDING_INVALID');
      }
      await this.writeAtomic(vault, verifyCandidate);
      committed = vault;
    });
    if (committed === null) throw new LocalSecretStoreError('VAULT_UNAVAILABLE');
    return committed;
  }

  private async withLock(operation: () => Promise<void>): Promise<void> {
    await mkdir(this.directoryPath, { recursive: true, mode: 0o700 });
    await chmod(this.directoryPath, 0o700);
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(this.directoryPath, {
        realpath: false,
        stale: 10_000,
        update: 2_000,
        retries: { retries: 20, factor: 1, minTimeout: 50, maxTimeout: 50 },
      });
      await operation();
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError) throw error;
      throw new LocalSecretStoreError('VAULT_LOCK_TIMEOUT');
    } finally {
      await release?.().catch(() => undefined);
    }
  }

  private async writeAtomic(
    vault: LocalSecretVault,
    verifyCandidate?: (candidate: LocalSecretVault) => Promise<void>,
  ): Promise<void> {
    const temporaryPath = join(this.directoryPath, `.local-secret-vault.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(vault)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await chmod(temporaryPath, 0o600);
      if (verifyCandidate !== undefined) {
        const serialized = await readFile(temporaryPath, 'utf8');
        const reopened = LocalSecretVaultSchema.safeParse(JSON.parse(serialized) as unknown);
        if (!reopened.success) throw new LocalSecretStoreError('VAULT_CORRUPTED');
        await verifyCandidate(reopened.data);
      }
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch (error: unknown) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      if (error instanceof LocalSecretStoreError) throw error;
      throw new LocalSecretStoreError('VAULT_UNAVAILABLE');
    }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
