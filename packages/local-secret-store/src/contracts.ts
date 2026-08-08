import {
  MAX_SECRET_REFERENCE_NAME_LENGTH,
  isSafeSecretAlias,
} from '@tasktwin/workflow-inputs';
import { z } from 'zod';

import {
  LOCAL_SECRET_CONTENT_ALGORITHM,
  LOCAL_SECRET_INVENTORY_PROFILE,
  LOCAL_SECRET_KDF_ALGORITHM,
  LOCAL_SECRET_KDF_N,
  LOCAL_SECRET_KDF_P,
  LOCAL_SECRET_KDF_R,
  LOCAL_SECRET_MASTER_KEY_PROFILE,
  MAX_NATIVE_PROTECTED_KEY_BYTES,
  LOCAL_SECRET_RECORD_PROFILE,
  LOCAL_SECRET_STORE_SCHEMA_VERSION,
  MAX_LOCAL_SECRET_CHARACTERS,
  MAX_LOCAL_SECRET_RECORDS,
  WINDOWS_NATIVE_MASTER_KEY_ALGORITHM,
  WINDOWS_NATIVE_MASTER_KEY_PROFILE,
} from './constants.js';

export const LocalSecretUuidSchema = z.string().uuid();
export const LocalSecretDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const LocalSecretTimestampSchema = z.string().datetime({ offset: true });
export const LocalSecretBase64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const LocalSecretAliasSchema = z
  .string()
  .min(1)
  .max(MAX_SECRET_REFERENCE_NAME_LENGTH)
  .refine(isSafeSecretAlias, 'Secret alias is invalid.');

export const LocalSecretTextSchema = z
  .string()
  .min(1)
  .max(MAX_LOCAL_SECRET_CHARACTERS);

export const LocalSecretStoreStatusSchema = z.enum([
  'ready',
  'locked',
  'unavailable',
  'corrupted',
]);

export const LocalSecretInventoryEntrySchema = z.strictObject({
  alias: LocalSecretAliasSchema,
  secretVersionId: LocalSecretUuidSchema,
});

export const LocalSecretScryptParametersSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  algorithm: z.literal(LOCAL_SECRET_KDF_ALGORITHM),
  salt: LocalSecretBase64UrlSchema.max(128),
  n: z.literal(LOCAL_SECRET_KDF_N),
  r: z.literal(LOCAL_SECRET_KDF_R),
  p: z.literal(LOCAL_SECRET_KDF_P),
  keyLength: z.literal(32),
});

export const PassphraseLocalSecretMasterKeyProtectionSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  profile: z.literal(LOCAL_SECRET_MASTER_KEY_PROFILE),
  kdf: LocalSecretScryptParametersSchema,
  wrappingAlgorithm: z.literal(LOCAL_SECRET_CONTENT_ALGORITHM),
  iv: LocalSecretBase64UrlSchema.max(64),
  ciphertext: LocalSecretBase64UrlSchema.max(256),
});

export const WindowsNativeLocalSecretMasterKeyProtectionSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  profile: z.literal(WINDOWS_NATIVE_MASTER_KEY_PROFILE),
  algorithm: z.literal(WINDOWS_NATIVE_MASTER_KEY_ALGORITHM),
  bindingProfile: z.literal('windows_machine_and_vault_acl_v1'),
  protectedKey: LocalSecretBase64UrlSchema.max(
    Math.ceil((MAX_NATIVE_PROTECTED_KEY_BYTES * 4) / 3) + 4,
  ),
});

export const LocalSecretMasterKeyProtectionSchema = z.discriminatedUnion('profile', [
  PassphraseLocalSecretMasterKeyProtectionSchema,
  WindowsNativeLocalSecretMasterKeyProtectionSchema,
]);

export const EncryptedLocalSecretRecordSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  profile: z.literal(LOCAL_SECRET_RECORD_PROFILE),
  algorithm: z.literal(LOCAL_SECRET_CONTENT_ALGORITHM),
  alias: LocalSecretAliasSchema,
  recordId: LocalSecretUuidSchema,
  secretVersionId: LocalSecretUuidSchema,
  iv: LocalSecretBase64UrlSchema.max(64),
  ciphertext: LocalSecretBase64UrlSchema.max(32 * 1024),
  createdAt: LocalSecretTimestampSchema,
  updatedAt: LocalSecretTimestampSchema,
});

export const LocalSecretVaultSchema = z
  .strictObject({
    schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
    vaultId: LocalSecretUuidSchema,
    workspaceId: LocalSecretUuidSchema,
    runnerDeviceId: LocalSecretUuidSchema,
    revision: z.number().int().positive().max(2_147_483_647),
    inventoryDigest: LocalSecretDigestSchema,
    masterKeyProtection: LocalSecretMasterKeyProtectionSchema,
    records: z.array(EncryptedLocalSecretRecordSchema).max(MAX_LOCAL_SECRET_RECORDS),
    createdAt: LocalSecretTimestampSchema,
    updatedAt: LocalSecretTimestampSchema,
  })
  .superRefine((vault, context) => {
    const aliases = new Set<string>();
    const records = new Set<string>();
    const versions = new Set<string>();
    vault.records.forEach((record, index) => {
      if (aliases.has(record.alias)) {
        context.addIssue({ code: 'custom', path: ['records', index, 'alias'], message: 'Aliases must be unique.' });
      }
      if (records.has(record.recordId)) {
        context.addIssue({ code: 'custom', path: ['records', index, 'recordId'], message: 'Record IDs must be unique.' });
      }
      if (versions.has(record.secretVersionId)) {
        context.addIssue({ code: 'custom', path: ['records', index, 'secretVersionId'], message: 'Secret version IDs must be unique.' });
      }
      aliases.add(record.alias);
      records.add(record.recordId);
      versions.add(record.secretVersionId);
    });
  });

const InventoryBaseSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  profile: z.literal(LOCAL_SECRET_INVENTORY_PROFILE),
  vaultId: LocalSecretUuidSchema,
  vaultRevision: z.number().int().positive().max(2_147_483_647),
  inventoryDigest: LocalSecretDigestSchema,
});

export const LocalSecretInventorySnapshotSchema = InventoryBaseSchema.extend({
  storeStatus: z.literal('ready'),
  entries: z.array(LocalSecretInventoryEntrySchema).max(MAX_LOCAL_SECRET_RECORDS),
}).superRefine((snapshot, context) => {
  const aliases = new Set<string>();
  const versions = new Set<string>();
  snapshot.entries.forEach((entry, index) => {
    if (aliases.has(entry.alias)) context.addIssue({ code: 'custom', path: ['entries', index, 'alias'], message: 'Aliases must be unique.' });
    if (versions.has(entry.secretVersionId)) context.addIssue({ code: 'custom', path: ['entries', index, 'secretVersionId'], message: 'Secret versions must be unique.' });
    aliases.add(entry.alias);
    versions.add(entry.secretVersionId);
  });
});

export const LocalSecretInventoryStatusReportSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  profile: z.literal(LOCAL_SECRET_INVENTORY_PROFILE),
  storeStatus: LocalSecretStoreStatusSchema.exclude(['ready']),
});

export const LocalSecretInventorySyncRequestSchema = z.union([
  LocalSecretInventorySnapshotSchema,
  LocalSecretInventoryStatusReportSchema,
]);

export const LocalSecretInventorySyncResponseSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  idempotent: z.boolean(),
  vaultId: LocalSecretUuidSchema,
  vaultRevision: z.number().int().positive(),
  inventoryDigest: LocalSecretDigestSchema,
  storeStatus: LocalSecretStoreStatusSchema,
  synchronizedAt: LocalSecretTimestampSchema,
});

export const LocalSecretInventoryPinSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  vaultId: LocalSecretUuidSchema,
  vaultRevision: z.number().int().positive().max(2_147_483_647),
  inventoryDigest: LocalSecretDigestSchema,
});

export const LocalSecretRecordAadSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  profile: z.literal(LOCAL_SECRET_RECORD_PROFILE),
  algorithm: z.literal(LOCAL_SECRET_CONTENT_ALGORITHM),
  vaultId: LocalSecretUuidSchema,
  workspaceId: LocalSecretUuidSchema,
  runnerDeviceId: LocalSecretUuidSchema,
  alias: LocalSecretAliasSchema,
  recordId: LocalSecretUuidSchema,
  secretVersionId: LocalSecretUuidSchema,
});

export const LocalSecretMasterKeyAadBaseSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SECRET_STORE_SCHEMA_VERSION),
  profile: z.literal(LOCAL_SECRET_MASTER_KEY_PROFILE),
  algorithm: z.literal(LOCAL_SECRET_CONTENT_ALGORITHM),
  vaultId: LocalSecretUuidSchema,
  workspaceId: LocalSecretUuidSchema,
  runnerDeviceId: LocalSecretUuidSchema,
  revision: z.number().int().positive(),
  inventoryDigest: LocalSecretDigestSchema,
});

export const LocalSecretMasterKeyAadSchema = LocalSecretMasterKeyAadBaseSchema.extend({
  kdf: LocalSecretScryptParametersSchema,
});

export type LocalSecretStoreStatus = z.infer<typeof LocalSecretStoreStatusSchema>;
export type LocalSecretInventoryEntry = z.infer<typeof LocalSecretInventoryEntrySchema>;
export type LocalSecretMasterKeyProtection = z.infer<typeof LocalSecretMasterKeyProtectionSchema>;
export type PassphraseLocalSecretMasterKeyProtection = z.infer<
  typeof PassphraseLocalSecretMasterKeyProtectionSchema
>;
export type WindowsNativeLocalSecretMasterKeyProtection = z.infer<
  typeof WindowsNativeLocalSecretMasterKeyProtectionSchema
>;
export type EncryptedLocalSecretRecord = z.infer<typeof EncryptedLocalSecretRecordSchema>;
export type LocalSecretVault = z.infer<typeof LocalSecretVaultSchema>;
export type LocalSecretInventorySnapshot = z.infer<typeof LocalSecretInventorySnapshotSchema>;
export type LocalSecretInventoryStatusReport = z.infer<typeof LocalSecretInventoryStatusReportSchema>;
export type LocalSecretInventorySyncRequest = z.infer<typeof LocalSecretInventorySyncRequestSchema>;
export type LocalSecretInventorySyncResponse = z.infer<typeof LocalSecretInventorySyncResponseSchema>;
export type LocalSecretInventoryPin = z.infer<typeof LocalSecretInventoryPinSchema>;
export type LocalSecretRecordAad = z.infer<typeof LocalSecretRecordAadSchema>;
export type LocalSecretMasterKeyAadBase = z.infer<typeof LocalSecretMasterKeyAadBaseSchema>;
export type LocalSecretMasterKeyAad = z.infer<typeof LocalSecretMasterKeyAadSchema>;
