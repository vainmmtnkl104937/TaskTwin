import { z } from 'zod';

export const LocalSecretStoreErrorCodeSchema = z.enum([
  'SECRET_ALIAS_INVALID',
  'SECRET_VALUE_INVALID',
  'VAULT_ALREADY_INITIALIZED',
  'VAULT_NOT_INITIALIZED',
  'VAULT_LOCKED',
  'VAULT_UNAVAILABLE',
  'VAULT_CORRUPTED',
  'VAULT_BINDING_INVALID',
  'VAULT_UNLOCK_FAILED',
  'VAULT_REVISION_CONFLICT',
  'VAULT_LOCK_TIMEOUT',
  'SECRET_NOT_FOUND',
  'SECRET_DECRYPTION_FAILED',
  'SECRET_INVENTORY_INVALID',
  'SECRET_INVENTORY_REVISION_CONFLICT',
  'SECRET_INVENTORY_ROLLBACK_DETECTED',
  'SECRET_VAULT_IDENTITY_CONFLICT',
  'SECRET_INVENTORY_SYNC_FAILED',
  'SENSITIVE_STATE_CLEANUP_FAILED',
  'MASTER_KEY_LEASE_DISPOSED',
  'MASTER_KEY_PROTECTOR_UNSUPPORTED',
  'NATIVE_PROTECTOR_UNAVAILABLE',
  'NATIVE_PROTECTOR_BINDING_INVALID',
  'NATIVE_PROTECTOR_FAILED',
  'PROTECTOR_MIGRATION_INVALID',
  'PROTECTOR_MIGRATION_VERIFICATION_FAILED',
]);

export type LocalSecretStoreErrorCode = z.infer<typeof LocalSecretStoreErrorCodeSchema>;

const MESSAGES: Record<LocalSecretStoreErrorCode, string> = {
  SECRET_ALIAS_INVALID: 'The secret alias is invalid.',
  SECRET_VALUE_INVALID: 'The secret value is invalid.',
  VAULT_ALREADY_INITIALIZED: 'The Local Secret Store is already initialized.',
  VAULT_NOT_INITIALIZED: 'The Local Secret Store is not initialized.',
  VAULT_LOCKED: 'The Local Secret Store is locked.',
  VAULT_UNAVAILABLE: 'The Local Secret Store is unavailable.',
  VAULT_CORRUPTED: 'The Local Secret Store is corrupted.',
  VAULT_BINDING_INVALID: 'The Local Secret Store binding is invalid.',
  VAULT_UNLOCK_FAILED: 'The Local Secret Store could not be unlocked.',
  VAULT_REVISION_CONFLICT: 'The Local Secret Store changed concurrently.',
  VAULT_LOCK_TIMEOUT: 'The Local Secret Store is busy.',
  SECRET_NOT_FOUND: 'A required local secret is unavailable.',
  SECRET_DECRYPTION_FAILED: 'A required local secret could not be authenticated.',
  SECRET_INVENTORY_INVALID: 'The local secret inventory is invalid.',
  SECRET_INVENTORY_REVISION_CONFLICT: 'The local secret inventory revision conflicts with current state.',
  SECRET_INVENTORY_ROLLBACK_DETECTED: 'A local secret inventory rollback was detected.',
  SECRET_VAULT_IDENTITY_CONFLICT: 'The local secret vault identity conflicts with current state.',
  SECRET_INVENTORY_SYNC_FAILED: 'The local secret inventory could not be synchronized.',
  SENSITIVE_STATE_CLEANUP_FAILED: 'Sensitive local state cleanup failed.',
  MASTER_KEY_LEASE_DISPOSED: 'The local master-key lease is no longer available.',
  MASTER_KEY_PROTECTOR_UNSUPPORTED: 'The local master-key protector is unsupported.',
  NATIVE_PROTECTOR_UNAVAILABLE: 'Windows native key protection is unavailable.',
  NATIVE_PROTECTOR_BINDING_INVALID: 'Windows native key protection binding is invalid.',
  NATIVE_PROTECTOR_FAILED: 'Windows native key protection failed safely.',
  PROTECTOR_MIGRATION_INVALID: 'The master-key protector migration is invalid.',
  PROTECTOR_MIGRATION_VERIFICATION_FAILED: 'The master-key protector migration could not be verified.',
};

export class LocalSecretStoreError extends Error {
  constructor(readonly code: LocalSecretStoreErrorCode) {
    super(MESSAGES[code]);
    this.name = 'LocalSecretStoreError';
  }
}
