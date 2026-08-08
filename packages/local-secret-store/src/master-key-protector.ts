import type {
  LocalSecretMasterKeyAadBase,
  LocalSecretMasterKeyProtection,
} from './contracts.js';

export interface LocalSecretMasterKeyProtector {
  protect(input: {
    masterKey: Uint8Array;
    passphrase: Uint8Array;
    aad: LocalSecretMasterKeyAadBase;
  }): Promise<LocalSecretMasterKeyProtection>;
  unprotect(input: {
    protection: LocalSecretMasterKeyProtection;
    passphrase: Uint8Array;
    aad: LocalSecretMasterKeyAadBase;
  }): Promise<Uint8Array>;
}
