export const LOCAL_SECRET_STORE_SCHEMA_VERSION = 1;
export const LOCAL_SECRET_RECORD_PROFILE = 'local_secret_record_v1';
export const LOCAL_SECRET_MASTER_KEY_PROFILE =
  'local_secret_master_key_wrap_v1';
export const LOCAL_SECRET_INVENTORY_PROFILE = 'local_secret_inventory_v1';
export const LOCAL_SECRET_CONTENT_ALGORITHM = 'AES-256-GCM';
export const LOCAL_SECRET_KDF_ALGORITHM = 'scrypt-rfc7914-v1';
export const LOCAL_SECRET_KDF_N = 131_072;
export const LOCAL_SECRET_KDF_R = 8;
export const LOCAL_SECRET_KDF_P = 1;
export const LOCAL_SECRET_KEY_BYTES = 32;
export const LOCAL_SECRET_IV_BYTES = 12;
export const LOCAL_SECRET_TAG_BYTES = 16;
export const LOCAL_SECRET_KDF_SALT_BYTES = 16;
export const LOCAL_SECRET_KDF_MAX_MEMORY_BYTES = 256 * 1024 * 1024;
export const MAX_LOCAL_SECRET_CHARACTERS = 4_096;
export const MAX_LOCAL_SECRET_RECORDS = 1_000;
export const MAX_LOCAL_VAULT_FILE_BYTES = 16 * 1024 * 1024;
