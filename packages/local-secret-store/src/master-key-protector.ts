import type {
  LocalSecretMasterKeyAadBase,
  LocalSecretMasterKeyProtection,
} from './contracts.js';
import { LocalSecretStoreError } from './errors.js';

export interface LocalSecretMasterKeyProtector {
  readonly profile: LocalSecretMasterKeyProtection['profile'];
  protect(input: {
    masterKey: Uint8Array;
    passphrase?: Uint8Array;
    aad: LocalSecretMasterKeyAadBase;
  }): Promise<LocalSecretMasterKeyProtection>;
  unprotect(input: {
    protection: LocalSecretMasterKeyProtection;
    passphrase?: Uint8Array;
    aad: LocalSecretMasterKeyAadBase;
  }): Promise<MasterKeyLease>;
}

export interface MasterKeyLease {
  readonly disposed: boolean;
  use<T>(operation: (masterKey: Uint8Array) => T): T;
  dispose(): void;
}

export class InMemoryMasterKeyLease implements MasterKeyLease {
  private value: Uint8Array | null;

  constructor(masterKey: Uint8Array) {
    this.value = Uint8Array.from(masterKey);
  }

  get disposed(): boolean {
    return this.value === null;
  }

  use<T>(operation: (masterKey: Uint8Array) => T): T {
    if (this.value === null) {
      throw new LocalSecretStoreError('MASTER_KEY_LEASE_DISPOSED');
    }
    return operation(this.value);
  }

  dispose(): void {
    this.value?.fill(0);
    this.value = null;
  }
}
