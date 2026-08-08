import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileLocalSecretVaultStore } from '../../secrets/local-secret-vault-store.js';
import { LocalSecretVaultService } from '../../secrets/local-secret-vault-service.js';
import { NodeScryptMasterKeyProtector } from '../../secrets/node-secret-crypto.js';
import {
  WINDOWS_NATIVE_PROTECTION_DESCRIPTOR,
  WindowsNativeMasterKeyProtector,
} from './windows-native-master-key-protector.js';

const onlyOnWindows = process.platform === 'win32' ? describe : describe.skip;

onlyOnWindows('Windows DPAPI-NG master-key protection', () => {
  it('round-trips a master key under the current Windows identity', async () => {
    const protector = new WindowsNativeMasterKeyProtector(
      WINDOWS_NATIVE_PROTECTION_DESCRIPTOR,
    );
    const masterKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const aad = {
      schemaVersion: 1 as const,
      profile: 'local_secret_master_key_wrap_v1' as const,
      algorithm: 'AES-256-GCM' as const,
      vaultId: '753ff8fc-4267-4d99-b741-41485f5bab45',
      workspaceId: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
      runnerDeviceId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      revision: 2,
      inventoryDigest: 'a'.repeat(64),
    };
    const protection = await protector.protect({ masterKey, aad });
    if (protection.profile !== 'windows_dpapi_ng_machine_v1') {
      throw new Error('The native protector returned another profile.');
    }
    expect(protection.protectedKey).not.toContain(
      Buffer.from(masterKey).toString('base64url'),
    );
    const lease = await protector.unprotect({ protection, aad });
    expect(lease.use((value) => [...value])).toEqual([...masterKey]);
    lease.dispose();
    expect(lease.disposed).toBe(true);
  });

  it('migrates and reopens an encrypted vault without a passphrase', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tasktwin-native-vault-'));
    const passphrase = Buffer.from('windows-native-integration-passphrase');
    const plaintext = 'WINDOWS_NATIVE_SECRET_30';
    try {
      const store = new FileLocalSecretVaultStore(root);
      const native = new WindowsNativeMasterKeyProtector(
        WINDOWS_NATIVE_PROTECTION_DESCRIPTOR,
      );
      const service = new LocalSecretVaultService(store, [
        new NodeScryptMasterKeyProtector(),
        native,
      ]);
      const initialized = await service.initialize({
        workspaceId: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
        runnerDeviceId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
        passphrase,
      });
      await service.setSecret({
        alias: 'LOGIN_PASSWORD',
        plaintext,
        passphrase,
      });
      const beforeMigration = await store.load();
      const migrated = await service.migrateProtectorToNative({
        workspaceId: initialized.workspaceId,
        runnerDeviceId: initialized.runnerDeviceId,
        passphrase,
      });
      expect(migrated.revision).toBe((beforeMigration?.revision ?? 0) + 1);
      await service.dispose();
      await service.unlock({
        workspaceId: initialized.workspaceId,
        runnerDeviceId: initialized.runnerDeviceId,
      });
      await expect(
        service.acquireValues([
          { secretName: 'LOGIN_PASSWORD', usageCount: 1 },
        ]),
      ).resolves.toEqual({ LOGIN_PASSWORD: plaintext });
      const persisted = await readFile(store.filePath, 'utf8');
      expect(persisted).not.toContain(plaintext);
      expect(persisted).not.toContain(passphrase.toString('utf8'));
      await service.dispose();
    } finally {
      passphrase.fill(0);
      await rm(root, { recursive: true, force: true });
    }
  });
});
