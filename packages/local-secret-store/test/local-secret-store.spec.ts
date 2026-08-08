import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  EncryptedLocalSecretRecordSchema,
  LocalSecretAliasSchema,
  LocalSecretInventorySnapshotSchema,
  LocalSecretTextSchema,
  LocalSecretVaultSchema,
  canonicalizeLocalSecretInventory,
  createLocalSecretInventoryDigest,
  encodeLocalSecretRecordAad,
  LocalSecretStoreError,
} from '../src/index.js';

const workspaceId = '85ea1dc3-0ab5-4407-b54a-f98015c99729';
const runnerDeviceId = '15448cc6-d20d-4b89-961e-f090f29baa10';
const vaultId = '9c8cab4d-a965-4812-8b27-e172f93e508e';

const hasher = { sha256Hex: (input: string) => createHash('sha256').update(input).digest('hex') };

describe('local secret store contracts', () => {
  it('validates aliases and bounded text secrets', () => {
    expect(LocalSecretAliasSchema.parse('LOGIN_PASSWORD')).toBe('LOGIN_PASSWORD');
    expect(() => LocalSecretAliasSchema.parse('not an alias')).toThrow();
    expect(LocalSecretTextSchema.parse('x')).toBe('x');
    expect(() => LocalSecretTextSchema.parse('x'.repeat(4_097))).toThrow();
  });

  it('creates deterministic AAD bound to every required identity', () => {
    const input = { schemaVersion: 1 as const, profile: 'local_secret_record_v1' as const,
      algorithm: 'AES-256-GCM' as const, vaultId, workspaceId, runnerDeviceId,
      alias: 'LOGIN_PASSWORD', recordId: randomUUID(), secretVersionId: randomUUID() };
    expect(encodeLocalSecretRecordAad(input)).toBe(encodeLocalSecretRecordAad({ ...input }));
    expect(encodeLocalSecretRecordAad(input)).toContain(workspaceId);
    expect(encodeLocalSecretRecordAad(input)).toContain(runnerDeviceId);
  });

  it('canonicalizes and digests inventory independent of entry order', () => {
    const entries = [
      { alias: 'Z_SECRET', secretVersionId: randomUUID() },
      { alias: 'A_SECRET', secretVersionId: randomUUID() },
    ];
    const input = { vaultId, workspaceId, runnerDeviceId, vaultRevision: 3, entries };
    expect(canonicalizeLocalSecretInventory(input)).toBe(
      canonicalizeLocalSecretInventory({ ...input, entries: [...entries].reverse() }),
    );
    expect(createLocalSecretInventoryDigest(hasher, input)).toBe(
      createLocalSecretInventoryDigest(hasher, { ...input, entries: [...entries].reverse() }),
    );
  });

  it('strictly rejects unexpected and prohibited persisted properties', () => {
    const entry = { alias: 'LOGIN_PASSWORD', secretVersionId: randomUUID() };
    const digest = createLocalSecretInventoryDigest(hasher, {
      vaultId, workspaceId, runnerDeviceId, vaultRevision: 1, entries: [entry],
    });
    expect(() => LocalSecretInventorySnapshotSchema.parse({ schemaVersion: 1,
      profile: 'local_secret_inventory_v1', vaultId, vaultRevision: 1,
      inventoryDigest: digest, storeStatus: 'ready', entries: [entry], plaintext: 'forbidden' })).toThrow();
    expect(() => EncryptedLocalSecretRecordSchema.parse({ schemaVersion: 1,
      profile: 'local_secret_record_v1', algorithm: 'AES-256-GCM', alias: entry.alias,
      recordId: randomUUID(), secretVersionId: entry.secretVersionId, iv: 'AAAA',
      ciphertext: 'BBBB', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      value: 'forbidden' })).toThrow();
    expect(LocalSecretVaultSchema.keyof().options).not.toContain('plaintext');
    expect(LocalSecretVaultSchema.keyof().options).not.toContain('secretValueHash');
  });

  it('keeps stable errors independent of sensitive input', () => {
    const recognizable = 'LOCAL_SECRET_ERROR_VALUE_29';
    const error = new LocalSecretStoreError('SECRET_DECRYPTION_FAILED');
    expect(error.code).toBe('SECRET_DECRYPTION_FAILED');
    expect(error.message).not.toContain(recognizable);
    expect(JSON.stringify(error)).not.toContain(recognizable);
  });

  it('rejects ciphertext, plaintext and value hashes from inventory requests', () => {
    expect(() => LocalSecretInventorySnapshotSchema.parse({
      schemaVersion: 1,
      profile: 'local_secret_inventory_v1',
      vaultId,
      vaultRevision: 1,
      inventoryDigest: 'a'.repeat(64),
      storeStatus: 'ready',
      entries: [],
      ciphertext: 'forbidden',
      secretValueHash: 'forbidden',
      plaintext: 'forbidden',
    })).toThrow();
  });
});
