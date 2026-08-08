import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalSecretStoreError } from '@tasktwin/local-secret-store';

import { FileLocalSecretVaultStore } from './local-secret-vault-store.js';
import { LocalSecretVaultService } from './local-secret-vault-service.js';
import { LocalVaultSecretProvider } from './local-vault-secret-provider.js';
import {
  NodeScryptMasterKeyProtector,
  decryptLocalSecretRecord,
  encryptLocalSecretRecord,
  generateLocalSecretMasterKey,
} from './node-secret-crypto.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tasktwin-local-secret-'));
  roots.push(root);
  const store = new FileLocalSecretVaultStore(root);
  const service = new LocalSecretVaultService(store, new NodeScryptMasterKeyProtector());
  const workspaceId = randomUUID();
  const runnerDeviceId = randomUUID();
  return { root, store, service, workspaceId, runnerDeviceId };
}

describe('encrypted local secret vault', () => {
  it('persists only authenticated ciphertext, rotates versions, and serves an execution lease', async () => {
    const value = 'SESSION_29_RECOGNIZABLE_PASSWORD';
    const { store, service, workspaceId, runnerDeviceId } = await fixture();
    const passphrase = Buffer.from('portable-test-passphrase');
    await service.initialize({ workspaceId, runnerDeviceId, passphrase });
    const first = await service.setSecret({ alias: 'LOGIN_PASSWORD', plaintext: value, passphrase });
    expect(await readFile(store.filePath, 'utf8')).not.toContain(value);
    expect(await readFile(store.filePath, 'utf8')).not.toContain('"masterKey":');
    const firstRecord = first.records[0]!;

    const second = await service.setSecret({ alias: 'LOGIN_PASSWORD', plaintext: value, passphrase });
    const secondRecord = second.records[0]!;
    expect(secondRecord.secretVersionId).not.toBe(firstRecord.secretVersionId);
    expect(secondRecord.iv).not.toBe(firstRecord.iv);
    expect(secondRecord.ciphertext).not.toBe(firstRecord.ciphertext);
    expect(await readFile(store.filePath, 'utf8')).not.toContain(value);

    const inventory = await service.inventory();
    service.markSynchronized({ schemaVersion: 1, vaultId: inventory.vaultId,
      vaultRevision: inventory.vaultRevision, inventoryDigest: inventory.inventoryDigest });
    const provider = new LocalVaultSecretProvider(service);
    provider.setExpectedPin({ schemaVersion: 1, vaultId: inventory.vaultId,
      vaultRevision: inventory.vaultRevision, inventoryDigest: inventory.inventoryDigest });
    const lease = await provider.acquire(
      [{ secretName: 'LOGIN_PASSWORD', usageCount: 1 }],
      new AbortController().signal,
    );
    expect(lease.resolve('LOGIN_PASSWORD')).toBe(value);
    await lease.dispose();
    expect(() => lease.resolve('LOGIN_PASSWORD')).toThrow();
    passphrase.fill(0);
  });

  it('fails closed for a wrong passphrase and tampered ciphertext', async () => {
    const { store, service, workspaceId, runnerDeviceId } = await fixture();
    const passphrase = Buffer.from('correct-test-passphrase');
    await service.initialize({ workspaceId, runnerDeviceId, passphrase });
    await service.setSecret({ alias: 'LOGIN_PASSWORD', plaintext: 'safe-value', passphrase });
    await service.dispose();
    await expect(service.unlock({ workspaceId, runnerDeviceId,
      passphrase: Buffer.from('wrong-test-passphrase') })).rejects.toMatchObject({
        code: 'VAULT_UNLOCK_FAILED',
      });
    await expect(service.unlock({ workspaceId: randomUUID(), runnerDeviceId,
      passphrase })).rejects.toMatchObject({ code: 'VAULT_BINDING_INVALID' });

    const vault = JSON.parse(await readFile(store.filePath, 'utf8')) as {
      records: Array<{ ciphertext: string }>;
    };
    vault.records[0]!.ciphertext = `${vault.records[0]!.ciphertext[0] === 'A' ? 'B' : 'A'}${vault.records[0]!.ciphertext.slice(1)}`;
    await writeFile(store.filePath, JSON.stringify(vault), { encoding: 'utf8', mode: 0o600 });
    await service.unlock({ workspaceId, runnerDeviceId, passphrase });
    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    await expect(service.acquireValues([{ secretName: 'LOGIN_PASSWORD', usageCount: 1 }]))
      .rejects.toBeInstanceOf(LocalSecretStoreError);
    passphrase.fill(0);
  });

  it('rejects stale revision replacement without overwriting the current vault', async () => {
    const { store, service, workspaceId, runnerDeviceId } = await fixture();
    const passphrase = Buffer.from('revision-test-passphrase');
    const initial = await service.initialize({ workspaceId, runnerDeviceId, passphrase });
    const current = await service.setSecret({ alias: 'A_SECRET', plaintext: 'value', passphrase });
    await writeFile(join(store.directoryPath, '.interrupted-vault-write.tmp'), '{incomplete', 'utf8');
    expect((await store.load())?.revision).toBe(current.revision);
    await expect(store.replace(initial.revision, {
      ...current,
      revision: initial.revision + 1,
    })).rejects.toMatchObject({ code: 'VAULT_REVISION_CONFLICT' });
    expect((await store.load())?.revision).toBe(current.revision);
    passphrase.fill(0);
  });

  it('authenticates Workspace and Runner AAD bindings', () => {
    const masterKey = generateLocalSecretMasterKey();
    const aad = {
      schemaVersion: 1 as const,
      profile: 'local_secret_record_v1' as const,
      algorithm: 'AES-256-GCM' as const,
      vaultId: randomUUID(),
      workspaceId: randomUUID(),
      runnerDeviceId: randomUUID(),
      alias: 'LOGIN_PASSWORD',
      recordId: randomUUID(),
      secretVersionId: randomUUID(),
    };
    try {
      const record = encryptLocalSecretRecord({ plaintext: 'aad-test-value',
        masterKey, aad, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString() });
      expect(decryptLocalSecretRecord({ record, masterKey, aad })).toBe('aad-test-value');
      expect(() => decryptLocalSecretRecord({ record, masterKey,
        aad: { ...aad, workspaceId: randomUUID() } })).toThrow();
      expect(() => decryptLocalSecretRecord({ record, masterKey,
        aad: { ...aad, runnerDeviceId: randomUUID() } })).toThrow();
    } finally {
      masterKey.fill(0);
    }
  });
});
