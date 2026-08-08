import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  InMemoryMasterKeyLease,
  LOCAL_SECRET_KEY_BYTES,
  LOCAL_SECRET_STORE_SCHEMA_VERSION,
  LocalSecretMasterKeyAadBaseSchema,
  LocalSecretStoreError,
  WINDOWS_NATIVE_MASTER_KEY_ALGORITHM,
  WINDOWS_NATIVE_MASTER_KEY_PROFILE,
  WindowsNativeLocalSecretMasterKeyProtectionSchema,
  serializeLocalSecretCanonicalJson,
  type LocalSecretMasterKeyAadBase,
  type LocalSecretMasterKeyProtection,
  type LocalSecretMasterKeyProtector,
  type MasterKeyLease,
} from '@tasktwin/local-secret-store';

import { PowerShellWindowsNativeProtectionBridge } from './windows-native-protection-bridge.js';

export const WINDOWS_NATIVE_PROTECTION_DESCRIPTOR = 'LOCAL=machine';

export interface WindowsNativeProtectionBridge {
  available(): Promise<boolean>;
  protect(input: Uint8Array, descriptor: string): Promise<Uint8Array>;
  unprotect(input: Uint8Array): Promise<Uint8Array>;
}

export class WindowsNativeMasterKeyProtector implements LocalSecretMasterKeyProtector {
  readonly profile = WINDOWS_NATIVE_MASTER_KEY_PROFILE;

  constructor(
    private readonly descriptor: string | (() => Promise<string>),
    private readonly bridge: WindowsNativeProtectionBridge =
      new PowerShellWindowsNativeProtectionBridge(
        join(dirname(fileURLToPath(import.meta.url)), 'windows-native-bridge.ps1'),
      ),
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.platform === 'win32' && this.bridge.available();
  }

  async protect(input: {
    masterKey: Uint8Array;
    passphrase?: Uint8Array;
    aad: LocalSecretMasterKeyAadBase;
  }): Promise<LocalSecretMasterKeyProtection> {
    if (!(await this.isAvailable()) || input.masterKey.byteLength !== LOCAL_SECRET_KEY_BYTES) {
      throw new LocalSecretStoreError('NATIVE_PROTECTOR_UNAVAILABLE');
    }
    const payload = nativePayload(input.masterKey, input.aad);
    try {
      const protectedKey = await this.bridge.protect(
        payload,
        typeof this.descriptor === 'string'
          ? this.descriptor
          : await this.descriptor(),
      );
      return WindowsNativeLocalSecretMasterKeyProtectionSchema.parse({
        schemaVersion: LOCAL_SECRET_STORE_SCHEMA_VERSION,
        profile: WINDOWS_NATIVE_MASTER_KEY_PROFILE,
        algorithm: WINDOWS_NATIVE_MASTER_KEY_ALGORITHM,
        bindingProfile: 'windows_machine_and_vault_acl_v1',
        protectedKey: Buffer.from(protectedKey).toString('base64url'),
      });
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError) throw error;
      throw new LocalSecretStoreError('NATIVE_PROTECTOR_FAILED');
    } finally {
      payload.fill(0);
    }
  }

  async unprotect(input: {
    protection: LocalSecretMasterKeyProtection;
    passphrase?: Uint8Array;
    aad: LocalSecretMasterKeyAadBase;
  }): Promise<MasterKeyLease> {
    const protection = WindowsNativeLocalSecretMasterKeyProtectionSchema.safeParse(
      input.protection,
    );
    if (!protection.success || !(await this.isAvailable())) {
      throw new LocalSecretStoreError('NATIVE_PROTECTOR_UNAVAILABLE');
    }
    const protectedKey = Buffer.from(protection.data.protectedKey, 'base64url');
    let payload: Uint8Array | null = null;
    try {
      payload = await this.bridge.unprotect(protectedKey);
      if (payload.byteLength !== LOCAL_SECRET_KEY_BYTES * 2) {
        throw new LocalSecretStoreError('NATIVE_PROTECTOR_BINDING_INVALID');
      }
      const expectedContext = contextDigest(input.aad);
      const actualContext = payload.subarray(0, LOCAL_SECRET_KEY_BYTES);
      if (!Buffer.from(actualContext).equals(expectedContext)) {
        throw new LocalSecretStoreError('NATIVE_PROTECTOR_BINDING_INVALID');
      }
      return new InMemoryMasterKeyLease(
        payload.subarray(LOCAL_SECRET_KEY_BYTES),
      );
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError) throw error;
      throw new LocalSecretStoreError('NATIVE_PROTECTOR_FAILED');
    } finally {
      protectedKey.fill(0);
      payload?.fill(0);
    }
  }
}

function nativePayload(
  masterKey: Uint8Array,
  aad: LocalSecretMasterKeyAadBase,
): Buffer {
  return Buffer.concat([contextDigest(aad), Buffer.from(masterKey)]);
}

function contextDigest(aad: LocalSecretMasterKeyAadBase): Buffer {
  const parsed = LocalSecretMasterKeyAadBaseSchema.parse(aad);
  return createHash('sha256')
    .update(serializeLocalSecretCanonicalJson(parsed), 'utf8')
    .digest();
}
