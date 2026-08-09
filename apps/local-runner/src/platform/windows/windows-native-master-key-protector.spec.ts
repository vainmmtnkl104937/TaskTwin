import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LOCAL_SECRET_CONTENT_ALGORITHM,
  LOCAL_SECRET_MASTER_KEY_PROFILE,
  LOCAL_SECRET_STORE_SCHEMA_VERSION,
  LocalSecretStoreError,
} from '@tasktwin/local-secret-store';

import { FileLocalSecretVaultStore } from '../../secrets/local-secret-vault-store.js';
import { LocalSecretVaultService } from '../../secrets/local-secret-vault-service.js';
import { NodeScryptMasterKeyProtector } from '../../secrets/node-secret-crypto.js';
import {
  WindowsNativeMasterKeyProtector,
  type WindowsNativeProtectionBridge,
} from './windows-native-master-key-protector.js';
import { nativeBridgePowerShellExecutable } from './windows-native-protection-bridge.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const runnerDeviceId = '22222222-2222-4222-8222-222222222222';
const passphrase = Buffer.from('correct horse battery staple');

class MemoryNativeBridge implements WindowsNativeProtectionBridge {
  failUnprotect = false;

  async available(): Promise<boolean> { return true; }
  async protect(input: Uint8Array): Promise<Uint8Array> {
    return Uint8Array.from(input).reverse();
  }
  async unprotect(input: Uint8Array): Promise<Uint8Array> {
    if (this.failUnprotect) throw new Error('native details must be hidden');
    return Uint8Array.from(input).reverse();
  }
}

describe('Windows native protection command boundary', () => {
  it('uses an absolute System32 PowerShell path', () => {
    const systemRoot = resolve(tmpdir(), 'Windows');
    const executable = nativeBridgePowerShellExecutable(systemRoot);
    expect(isAbsolute(executable)).toBe(true);
    expect(executable).toBe(
      join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
    );
    expect(() => nativeBridgePowerShellExecutable('relative')).toThrow();
  });
});

function aad(overrides: Partial<{ vaultId: string; runnerDeviceId: string }> = {}) {
  return {
    schemaVersion: LOCAL_SECRET_STORE_SCHEMA_VERSION,
    profile: LOCAL_SECRET_MASTER_KEY_PROFILE,
    algorithm: LOCAL_SECRET_CONTENT_ALGORITHM,
    vaultId: overrides.vaultId ?? '33333333-3333-4333-8333-333333333333',
    workspaceId,
    runnerDeviceId: overrides.runnerDeviceId ?? runnerDeviceId,
    revision: 1,
    inventoryDigest: 'a'.repeat(64),
  } as const;
}

describe('Windows native master-key protector', () => {
  it('protects, unwraps and rejects the wrong binding', async () => {
    const bridge = new MemoryNativeBridge();
    const protector = new WindowsNativeMasterKeyProtector(
      'LOCAL=machine', bridge, 'win32',
    );
    const key = Buffer.alloc(32, 7);
    const protection = await protector.protect({ masterKey: key, aad: aad() });
    expect(JSON.stringify(protection)).not.toContain(key.toString('base64'));
    const lease = await protector.unprotect({ protection, aad: aad() });
    expect(lease.use((value) => Buffer.from(value).equals(key))).toBe(true);
    lease.dispose();
    expect(lease.disposed).toBe(true);
    await expect(protector.unprotect({
      protection,
      aad: aad({ runnerDeviceId: '44444444-4444-4444-8444-444444444444' }),
    })).rejects.toMatchObject({ code: 'NATIVE_PROTECTOR_BINDING_INVALID' });
  });

  it('migrates atomically and preserves the previous vault on verification failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tasktwin-native-migration-'));
    try {
      const bridge = new MemoryNativeBridge();
      const store = new FileLocalSecretVaultStore(root);
      const native = new WindowsNativeMasterKeyProtector('LOCAL=machine', bridge, 'win32');
      const service = new LocalSecretVaultService(
        store,
        [new NodeScryptMasterKeyProtector(), native],
      );
      await service.initialize({ workspaceId, runnerDeviceId, passphrase });
      await service.setSecret({ alias: 'LOGIN_PASSWORD', plaintext: 'fixture-secret-30', passphrase });
      const before = await store.load();
      expect(before).not.toBeNull();
      const bytesBeforeWrongPassphrase = await readFile(store.filePath, 'utf8');
      await expect(
        service.migrateProtectorToNative({
          workspaceId,
          runnerDeviceId,
          passphrase: Buffer.from('incorrect passphrase'),
        }),
      ).rejects.toMatchObject({ code: 'VAULT_UNLOCK_FAILED' });
      expect(await readFile(store.filePath, 'utf8')).toBe(
        bytesBeforeWrongPassphrase,
      );
      const migrated = await service.migrateProtectorToNative({ workspaceId, runnerDeviceId, passphrase });
      expect(migrated.revision).toBe(before!.revision + 1);
      expect(migrated.masterKeyProtection.profile).toBe('windows_dpapi_ng_machine_v1');
      await service.dispose();
      await service.unlock({ workspaceId, runnerDeviceId });
      await expect(service.acquireValues([{ secretName: 'LOGIN_PASSWORD', usageCount: 1 }]))
        .resolves.toEqual({ LOGIN_PASSWORD: 'fixture-secret-30' });
      expect(await readFile(store.filePath, 'utf8')).not.toContain('fixture-secret-30');

      const secondRoot = await mkdtemp(join(tmpdir(), 'tasktwin-native-failure-'));
      try {
        const secondBridge = new MemoryNativeBridge();
        const secondStore = new FileLocalSecretVaultStore(secondRoot);
        const second = new LocalSecretVaultService(secondStore, [
          new NodeScryptMasterKeyProtector(),
          new WindowsNativeMasterKeyProtector('LOCAL=machine', secondBridge, 'win32'),
        ]);
        await second.initialize({ workspaceId, runnerDeviceId, passphrase });
        await second.setSecret({ alias: 'A_SECRET', plaintext: 'unchanged', passphrase });
        const validBefore = await readFile(secondStore.filePath, 'utf8');
        secondBridge.failUnprotect = true;
        await expect(second.migrateProtectorToNative({ workspaceId, runnerDeviceId, passphrase }))
          .rejects.toBeInstanceOf(LocalSecretStoreError);
        expect(await readFile(secondStore.filePath, 'utf8')).toBe(validBefore);
      } finally {
        await rm(secondRoot, { recursive: true, force: true });
      }
    } finally {
      passphrase.fill(0);
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
