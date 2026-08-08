import { randomUUID } from 'node:crypto';

import {
  LOCAL_SECRET_CONTENT_ALGORITHM,
  LOCAL_SECRET_MASTER_KEY_PROFILE,
  LOCAL_SECRET_STORE_SCHEMA_VERSION,
  LocalSecretAliasSchema,
  LocalSecretInventoryPinSchema,
  LocalSecretStoreError,
  LocalSecretTextSchema,
  LocalSecretVaultSchema,
  buildLocalSecretInventorySnapshot,
  createLocalSecretInventoryDigest,
  inventoryEntriesFromVault,
  localSecretInventoryMatches,
  type LocalSecretInventoryPin,
  type LocalSecretInventorySnapshot,
  type LocalSecretMasterKeyAadBase,
  type LocalSecretMasterKeyProtector,
  type LocalSecretStoreStatus,
  type LocalSecretVault,
} from '@tasktwin/local-secret-store';
import type { SecureSecretRequirement } from '@tasktwin/secure-run-inputs';

import type { LocalSecretVaultStore } from './local-secret-vault-store.js';
import {
  decryptLocalSecretRecord,
  encryptLocalSecretRecord,
  generateLocalSecretMasterKey,
  nodeLocalSecretDigestProvider,
} from './node-secret-crypto.js';

export interface LocalSecretVaultStatus {
  status: LocalSecretStoreStatus;
  vaultRevision: number | null;
  configuredSecretCount: number;
  synchronized: boolean;
}

export class LocalSecretVaultService {
  private masterKey: Uint8Array | null = null;
  private unlockedVaultId: string | null = null;
  private synchronizedPin: LocalSecretInventoryPin | null = null;

  constructor(
    private readonly store: LocalSecretVaultStore,
    private readonly protector: LocalSecretMasterKeyProtector,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async initialize(input: {
    workspaceId: string;
    runnerDeviceId: string;
    passphrase: Uint8Array;
  }): Promise<LocalSecretVault> {
    const masterKey = generateLocalSecretMasterKey();
    const vaultId = randomUUID();
    const revision = 1;
    const createdAt = this.now().toISOString();
    const inventoryDigest = createLocalSecretInventoryDigest(nodeLocalSecretDigestProvider, {
      vaultId,
      workspaceId: input.workspaceId,
      runnerDeviceId: input.runnerDeviceId,
      vaultRevision: revision,
      entries: [],
    });
    const aad = masterKeyAad({ vaultId, workspaceId: input.workspaceId,
      runnerDeviceId: input.runnerDeviceId, revision, inventoryDigest });
    try {
      const protection = await this.protector.protect({ masterKey, passphrase: input.passphrase, aad });
      const vault = LocalSecretVaultSchema.parse({
        schemaVersion: 1,
        vaultId,
        workspaceId: input.workspaceId,
        runnerDeviceId: input.runnerDeviceId,
        revision,
        inventoryDigest,
        masterKeyProtection: protection,
        records: [],
        createdAt,
        updatedAt: createdAt,
      });
      await this.store.create(vault);
      await this.adoptMasterKey(masterKey, vaultId);
      return vault;
    } finally {
      masterKey.fill(0);
    }
  }

  async unlock(input: {
    workspaceId: string;
    runnerDeviceId: string;
    passphrase: Uint8Array;
  }): Promise<LocalSecretVault> {
    const vault = await this.requireVault();
    if (vault.workspaceId !== input.workspaceId || vault.runnerDeviceId !== input.runnerDeviceId) {
      throw new LocalSecretStoreError('VAULT_BINDING_INVALID');
    }
    this.assertInventoryDigest(vault);
    const masterKey = await this.protector.unprotect({
      protection: vault.masterKeyProtection,
      passphrase: input.passphrase,
      aad: masterKeyAad(vault),
    });
    try {
      await this.adoptMasterKey(masterKey, vault.vaultId);
    } finally {
      masterKey.fill(0);
    }
    return vault;
  }

  async setSecret(input: {
    alias: string;
    plaintext: string;
    passphrase: Uint8Array;
  }): Promise<LocalSecretVault> {
    const alias = LocalSecretAliasSchema.safeParse(input.alias);
    const plaintext = LocalSecretTextSchema.safeParse(input.plaintext);
    if (!alias.success) throw new LocalSecretStoreError('SECRET_ALIAS_INVALID');
    if (!plaintext.success) throw new LocalSecretStoreError('SECRET_VALUE_INVALID');
    const current = await this.requireUnlockedVault();
    const masterKey = this.requireMasterKey();
    const timestamp = this.now().toISOString();
    const recordId = randomUUID();
    const secretVersionId = randomUUID();
    const record = encryptLocalSecretRecord({
      plaintext: plaintext.data,
      masterKey,
      aad: recordAad(current, alias.data, recordId, secretVersionId),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const records = [...current.records.filter((item) => item.alias !== alias.data), record]
      .sort((left, right) => left.alias.localeCompare(right.alias));
    return this.commitMutation(current, records, input.passphrase, timestamp);
  }

  async removeSecret(input: { alias: string; passphrase: Uint8Array }): Promise<LocalSecretVault> {
    const alias = LocalSecretAliasSchema.safeParse(input.alias);
    if (!alias.success) throw new LocalSecretStoreError('SECRET_ALIAS_INVALID');
    const current = await this.requireUnlockedVault();
    if (!current.records.some((record) => record.alias === alias.data)) {
      throw new LocalSecretStoreError('SECRET_NOT_FOUND');
    }
    return this.commitMutation(
      current,
      current.records.filter((record) => record.alias !== alias.data),
      input.passphrase,
      this.now().toISOString(),
    );
  }

  async acquireValues(
    requirements: readonly SecureSecretRequirement[],
    expectedPin?: LocalSecretInventoryPin,
  ): Promise<Record<string, string>> {
    const vault = await this.requireUnlockedVault();
    if (expectedPin !== undefined && !localSecretInventoryMatches(vaultPin(vault), expectedPin)) {
      throw new LocalSecretStoreError('SECRET_INVENTORY_REVISION_CONFLICT');
    }
    const unique = [...new Set(requirements.map((requirement) => LocalSecretAliasSchema.parse(requirement.secretName)))];
    const values: Record<string, string> = {};
    try {
      for (const alias of unique) {
        const record = vault.records.find((item) => item.alias === alias);
        if (record === undefined) throw new LocalSecretStoreError('SECRET_NOT_FOUND');
        values[alias] = decryptLocalSecretRecord({
          record,
          masterKey: this.requireMasterKey(),
          aad: recordAad(vault, alias, record.recordId, record.secretVersionId),
        });
      }
      return values;
    } catch (error: unknown) {
      clearValues(values);
      throw error;
    }
  }

  async inventory(): Promise<LocalSecretInventorySnapshot> {
    return buildLocalSecretInventorySnapshot(await this.requireUnlockedVault());
  }

  markSynchronized(pin: LocalSecretInventoryPin): void {
    this.synchronizedPin = LocalSecretInventoryPinSchema.parse(pin);
  }

  clearSynchronized(): void {
    this.synchronizedPin = null;
  }

  async isReady(): Promise<boolean> {
    if (this.masterKey === null || this.unlockedVaultId === null || this.synchronizedPin === null) return false;
    try {
      const vault = await this.requireUnlockedVault();
      return localSecretInventoryMatches(vaultPin(vault), this.synchronizedPin);
    } catch {
      return false;
    }
  }

  async status(): Promise<LocalSecretVaultStatus> {
    try {
      const vault = await this.store.load();
      if (vault === null) return { status: 'unavailable', vaultRevision: null, configuredSecretCount: 0, synchronized: false };
      const unlocked = this.masterKey !== null && this.unlockedVaultId === vault.vaultId;
      return {
        status: unlocked ? 'ready' : 'locked',
        vaultRevision: vault.revision,
        configuredSecretCount: vault.records.length,
        synchronized: unlocked && this.synchronizedPin !== null &&
          localSecretInventoryMatches(vaultPin(vault), this.synchronizedPin),
      };
    } catch (error: unknown) {
      return { status: error instanceof LocalSecretStoreError && error.code === 'VAULT_CORRUPTED'
        ? 'corrupted' : 'unavailable', vaultRevision: null, configuredSecretCount: 0, synchronized: false };
    }
  }

  async dispose(): Promise<void> {
    this.masterKey?.fill(0);
    this.masterKey = null;
    this.unlockedVaultId = null;
    this.synchronizedPin = null;
  }

  private async commitMutation(
    current: LocalSecretVault,
    records: LocalSecretVault['records'],
    passphrase: Uint8Array,
    timestamp: string,
  ): Promise<LocalSecretVault> {
    const revision = current.revision + 1;
    const entries = records.map((record) => ({ alias: record.alias, secretVersionId: record.secretVersionId }));
    const inventoryDigest = createLocalSecretInventoryDigest(nodeLocalSecretDigestProvider, {
      vaultId: current.vaultId,
      workspaceId: current.workspaceId,
      runnerDeviceId: current.runnerDeviceId,
      vaultRevision: revision,
      entries,
    });
    const protection = await this.protector.protect({
      masterKey: this.requireMasterKey(),
      passphrase,
      aad: masterKeyAad({ ...current, revision, inventoryDigest }),
    });
    const next = LocalSecretVaultSchema.parse({ ...current, revision, inventoryDigest,
      masterKeyProtection: protection, records, updatedAt: timestamp });
    await this.store.replace(current.revision, next);
    this.synchronizedPin = null;
    return next;
  }

  private async requireVault(): Promise<LocalSecretVault> {
    const vault = await this.store.load();
    if (vault === null) throw new LocalSecretStoreError('VAULT_NOT_INITIALIZED');
    return vault;
  }

  private async requireUnlockedVault(): Promise<LocalSecretVault> {
    const vault = await this.requireVault();
    if (this.masterKey === null || this.unlockedVaultId !== vault.vaultId) {
      throw new LocalSecretStoreError('VAULT_LOCKED');
    }
    this.assertInventoryDigest(vault);
    return vault;
  }

  private assertInventoryDigest(vault: LocalSecretVault): void {
    const digest = createLocalSecretInventoryDigest(nodeLocalSecretDigestProvider, {
      vaultId: vault.vaultId,
      workspaceId: vault.workspaceId,
      runnerDeviceId: vault.runnerDeviceId,
      vaultRevision: vault.revision,
      entries: inventoryEntriesFromVault(vault),
    });
    if (digest !== vault.inventoryDigest) throw new LocalSecretStoreError('VAULT_CORRUPTED');
  }

  private requireMasterKey(): Uint8Array {
    if (this.masterKey === null) throw new LocalSecretStoreError('VAULT_LOCKED');
    return this.masterKey;
  }

  private async adoptMasterKey(masterKey: Uint8Array, vaultId: string): Promise<void> {
    await this.dispose();
    this.masterKey = Uint8Array.from(masterKey);
    this.unlockedVaultId = vaultId;
  }
}

function masterKeyAad(vault: {
  vaultId: string; workspaceId: string; runnerDeviceId: string;
  revision: number; inventoryDigest: string;
}): LocalSecretMasterKeyAadBase {
  return {
    schemaVersion: LOCAL_SECRET_STORE_SCHEMA_VERSION,
    profile: LOCAL_SECRET_MASTER_KEY_PROFILE,
    algorithm: LOCAL_SECRET_CONTENT_ALGORITHM,
    vaultId: vault.vaultId,
    workspaceId: vault.workspaceId,
    runnerDeviceId: vault.runnerDeviceId,
    revision: vault.revision,
    inventoryDigest: vault.inventoryDigest,
  };
}

function recordAad(vault: { vaultId: string; workspaceId: string; runnerDeviceId: string }, alias: string, recordId: string, secretVersionId: string) {
  return { schemaVersion: 1 as const, profile: 'local_secret_record_v1' as const,
    algorithm: 'AES-256-GCM' as const, vaultId: vault.vaultId,
    workspaceId: vault.workspaceId, runnerDeviceId: vault.runnerDeviceId,
    alias, recordId, secretVersionId };
}

function vaultPin(vault: LocalSecretVault): LocalSecretInventoryPin {
  return { schemaVersion: 1, vaultId: vault.vaultId,
    vaultRevision: vault.revision, inventoryDigest: vault.inventoryDigest };
}

export function clearValues(values: Record<string, string>): void {
  for (const key of Object.keys(values)) {
    values[key] = '';
    delete values[key];
  }
}
