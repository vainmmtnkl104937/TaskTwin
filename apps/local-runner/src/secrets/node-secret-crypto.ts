import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
} from 'node:crypto';

import {
  LOCAL_SECRET_CONTENT_ALGORITHM,
  LOCAL_SECRET_IV_BYTES,
  LOCAL_SECRET_KDF_MAX_MEMORY_BYTES,
  LOCAL_SECRET_KDF_N,
  LOCAL_SECRET_KDF_P,
  LOCAL_SECRET_KDF_R,
  LOCAL_SECRET_KDF_SALT_BYTES,
  LOCAL_SECRET_KEY_BYTES,
  LOCAL_SECRET_MASTER_KEY_PROFILE,
  LOCAL_SECRET_RECORD_PROFILE,
  LOCAL_SECRET_STORE_SCHEMA_VERSION,
  LocalSecretMasterKeyProtectionSchema,
  InMemoryMasterKeyLease,
  LocalSecretStoreError,
  LocalSecretTextSchema,
  encodeLocalSecretMasterKeyAad,
  encodeLocalSecretRecordAad,
  type EncryptedLocalSecretRecord,
  type LocalSecretDigestProvider,
  type LocalSecretMasterKeyAadBase,
  type LocalSecretMasterKeyProtection,
  type LocalSecretMasterKeyProtector,
  type MasterKeyLease,
  type LocalSecretRecordAad,
} from '@tasktwin/local-secret-store';

export const nodeLocalSecretDigestProvider: LocalSecretDigestProvider = {
  sha256Hex: (input) => createHash('sha256').update(input, 'utf8').digest('hex'),
};

function deriveKey(passphrase: Uint8Array, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      LOCAL_SECRET_KEY_BYTES,
      {
        N: LOCAL_SECRET_KDF_N,
        r: LOCAL_SECRET_KDF_R,
        p: LOCAL_SECRET_KDF_P,
        maxmem: LOCAL_SECRET_KDF_MAX_MEMORY_BYTES,
      },
      (error, key) => error === null ? resolve(key) : reject(error),
    );
  });
}

function encryptAuthenticated(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: string,
): { iv: string; ciphertext: string } {
  const iv = randomBytes(LOCAL_SECRET_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}

function decryptAuthenticated(
  ciphertextValue: string,
  ivValue: string,
  key: Uint8Array,
  aad: string,
): Buffer {
  const ciphertext = Buffer.from(ciphertextValue, 'base64url');
  const iv = Buffer.from(ivValue, 'base64url');
  if (ciphertext.length <= 16 || iv.length !== LOCAL_SECRET_IV_BYTES) {
    ciphertext.fill(0);
    iv.fill(0);
    throw new Error('Invalid authenticated ciphertext.');
  }
  const content = ciphertext.subarray(0, -16);
  const tag = ciphertext.subarray(-16);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(content), decipher.final()]);
  } finally {
    ciphertext.fill(0);
    iv.fill(0);
  }
}

export class NodeScryptMasterKeyProtector implements LocalSecretMasterKeyProtector {
  readonly profile = LOCAL_SECRET_MASTER_KEY_PROFILE;

  async protect(input: {
    masterKey: Uint8Array;
    passphrase?: Uint8Array;
    aad: LocalSecretMasterKeyAadBase;
  }): Promise<LocalSecretMasterKeyProtection> {
    const salt = randomBytes(LOCAL_SECRET_KDF_SALT_BYTES);
    let wrappingKey: Buffer | null = null;
    try {
      if (input.passphrase === undefined) {
        throw new LocalSecretStoreError('VAULT_UNLOCK_FAILED');
      }
      wrappingKey = await deriveKey(input.passphrase, salt);
      const kdf = {
        schemaVersion: 1 as const,
        algorithm: 'scrypt-rfc7914-v1' as const,
        salt: salt.toString('base64url'),
        n: LOCAL_SECRET_KDF_N,
        r: LOCAL_SECRET_KDF_R,
        p: LOCAL_SECRET_KDF_P,
        keyLength: 32 as const,
      };
      const aad = { ...input.aad, kdf };
      const encrypted = encryptAuthenticated(
        input.masterKey,
        wrappingKey,
        encodeLocalSecretMasterKeyAad(aad),
      );
      return LocalSecretMasterKeyProtectionSchema.parse({
        schemaVersion: LOCAL_SECRET_STORE_SCHEMA_VERSION,
        profile: LOCAL_SECRET_MASTER_KEY_PROFILE,
        kdf,
        wrappingAlgorithm: LOCAL_SECRET_CONTENT_ALGORITHM,
        ...encrypted,
      });
    } catch {
      throw new LocalSecretStoreError('VAULT_UNLOCK_FAILED');
    } finally {
      salt.fill(0);
      wrappingKey?.fill(0);
    }
  }

  async unprotect(input: {
    protection: LocalSecretMasterKeyProtection;
    passphrase?: Uint8Array;
    aad: LocalSecretMasterKeyAadBase;
  }): Promise<MasterKeyLease> {
    const parsed = LocalSecretMasterKeyProtectionSchema.safeParse(input.protection);
    if (
      !parsed.success ||
      parsed.data.profile !== LOCAL_SECRET_MASTER_KEY_PROFILE ||
      input.passphrase === undefined
    ) {
      throw new LocalSecretStoreError('VAULT_UNLOCK_FAILED');
    }
    const salt = Buffer.from(parsed.data.kdf.salt, 'base64url');
    let wrappingKey: Buffer | null = null;
    try {
      wrappingKey = await deriveKey(input.passphrase, salt);
      const plaintext = decryptAuthenticated(
        parsed.data.ciphertext,
        parsed.data.iv,
        wrappingKey,
        encodeLocalSecretMasterKeyAad({ ...input.aad, kdf: parsed.data.kdf }),
      );
      if (plaintext.length !== LOCAL_SECRET_KEY_BYTES) {
        plaintext.fill(0);
        throw new Error('Invalid master key.');
      }
      const lease = new InMemoryMasterKeyLease(plaintext);
      plaintext.fill(0);
      return lease;
    } catch {
      throw new LocalSecretStoreError('VAULT_UNLOCK_FAILED');
    } finally {
      salt.fill(0);
      wrappingKey?.fill(0);
    }
  }
}

export function encryptLocalSecretRecord(input: {
  plaintext: string;
  masterKey: Uint8Array;
  aad: LocalSecretRecordAad;
  createdAt: string;
  updatedAt: string;
}): EncryptedLocalSecretRecord {
  const value = LocalSecretTextSchema.safeParse(input.plaintext);
  if (!value.success) throw new LocalSecretStoreError('SECRET_VALUE_INVALID');
  const plaintext = Buffer.from(value.data, 'utf8');
  try {
    return {
      schemaVersion: LOCAL_SECRET_STORE_SCHEMA_VERSION,
      profile: LOCAL_SECRET_RECORD_PROFILE,
      algorithm: LOCAL_SECRET_CONTENT_ALGORITHM,
      alias: input.aad.alias,
      recordId: input.aad.recordId,
      secretVersionId: input.aad.secretVersionId,
      ...encryptAuthenticated(
        plaintext,
        input.masterKey,
        encodeLocalSecretRecordAad(input.aad),
      ),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
  } finally {
    plaintext.fill(0);
  }
}

export function decryptLocalSecretRecord(input: {
  record: EncryptedLocalSecretRecord;
  masterKey: Uint8Array;
  aad: LocalSecretRecordAad;
}): string {
  let plaintext: Buffer | null = null;
  try {
    plaintext = decryptAuthenticated(
      input.record.ciphertext,
      input.record.iv,
      input.masterKey,
      encodeLocalSecretRecordAad(input.aad),
    );
    return LocalSecretTextSchema.parse(plaintext.toString('utf8'));
  } catch {
    throw new LocalSecretStoreError('SECRET_DECRYPTION_FAILED');
  } finally {
    plaintext?.fill(0);
  }
}

export function generateLocalSecretMasterKey(): Buffer {
  return randomBytes(LOCAL_SECRET_KEY_BYTES);
}
