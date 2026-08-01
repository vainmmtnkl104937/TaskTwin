import {
  RuntimeInputValueSchema,
  WorkflowRunInputSubmissionSchema,
} from '@tasktwin/workflow-inputs';
import {
  IdentifierSchema,
  WorkflowVariableValueTypeSchema,
} from '@tasktwin/workflow-schema';
import { z } from 'zod';

import {
  AES_GCM_IV_BYTES,
  CONTENT_ENCRYPTION_ALGORITHM,
  KEY_ENCRYPTION_ALGORITHM,
  MAX_CIPHERTEXT_BYTES,
  MAX_PUBLIC_KEY_BYTES,
  MAX_RUN_INPUT_VARIABLES,
  MAX_RUN_SECRET_REQUIREMENTS,
  MAX_WRAPPED_KEY_BYTES,
  SECURE_INPUT_CAPABILITIES,
  SECURE_INPUT_ENVELOPE_PROFILE,
  SECURE_RUN_INPUTS_SCHEMA_VERSION,
} from './constants.js';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

function maxBase64UrlCharacters(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

export const RunnerCapabilitySchema = z.enum(SECURE_INPUT_CAPABILITIES);
export const RunnerCapabilitiesSchema = z
  .array(RunnerCapabilitySchema)
  .max(SECURE_INPUT_CAPABILITIES.length)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: 'custom',
        message: 'Capabilities must be unique.',
      });
    }
  });

export const RunnerEncryptionKeyIdSchema = z
  .string()
  .regex(/^rk1_[A-Za-z0-9_-]{43}$/);

export const RunnerPublicKeyMetadataSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  keyId: RunnerEncryptionKeyIdSchema,
  profile: z.literal(SECURE_INPUT_ENVELOPE_PROFILE),
  algorithm: z.literal(KEY_ENCRYPTION_ALGORITHM),
  publicKeyFormat: z.literal('spki'),
  publicKeySpki: Base64UrlSchema.max(
    maxBase64UrlCharacters(MAX_PUBLIC_KEY_BYTES),
  ),
  fingerprint: Sha256DigestSchema,
});

export const RunnerEncryptionKeyRegistrationRequestSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  key: RunnerPublicKeyMetadataSchema,
});

export const RunnerEncryptionKeyRegistrationResponseSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  idempotent: z.boolean(),
  key: RunnerPublicKeyMetadataSchema,
});

export const SecureVariableDefinitionSchema = z.strictObject({
  name: IdentifierSchema,
  label: z.string().trim().min(1).max(120).optional(),
  valueType: WorkflowVariableValueTypeSchema.exclude(['file']),
  required: z.boolean(),
  requiredForRun: z.boolean(),
  usageCount: z.number().int().nonnegative(),
  description: z.string().trim().min(1).max(500).optional(),
});

export const SecureSecretRequirementSchema = z.strictObject({
  secretName: IdentifierSchema,
  usageCount: z.number().int().positive(),
});

export const SecureRunInputManifestSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  variables: z
    .array(SecureVariableDefinitionSchema)
    .max(MAX_RUN_INPUT_VARIABLES),
  secrets: z
    .array(SecureSecretRequirementSchema)
    .max(MAX_RUN_SECRET_REQUIREMENTS),
});

export const SecureExecutionOptionsSchema = z.strictObject({
  totalTimeoutMs: z.number().int().min(100).max(600_000),
  stepTimeoutMs: z.number().int().min(100).max(60_000),
});

export const RunInputAdditionalAuthenticatedDataSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  profile: z.literal(SECURE_INPUT_ENVELOPE_PROFILE),
  preparationId: UuidSchema,
  workflowRunId: UuidSchema,
  workspaceId: UuidSchema,
  workflowId: z.string().trim().min(1).max(256),
  workflowVersionId: UuidSchema,
  workflowVersion: z.number().int().positive(),
  definitionDigest: Sha256DigestSchema,
  runnerDeviceId: UuidSchema,
  keyId: RunnerEncryptionKeyIdSchema,
  keyFingerprint: Sha256DigestSchema,
  clientRunId: UuidSchema,
  allowedOrigins: z.array(z.string().url().max(512)).min(1).max(32),
  executionOptions: SecureExecutionOptionsSchema,
  expiresAt: IsoDateSchema,
});

export const RunInputPreparationMetadataSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  preparationId: UuidSchema,
  clientPreparationId: UuidSchema,
  clientRunId: UuidSchema,
  workflowRunId: UuidSchema,
  workspaceId: UuidSchema,
  workflowVersionId: UuidSchema,
  runnerDeviceId: UuidSchema,
  expiresAt: IsoDateSchema,
  manifest: SecureRunInputManifestSchema,
  key: RunnerPublicKeyMetadataSchema,
  aad: RunInputAdditionalAuthenticatedDataSchema,
});

export const RunInputPreparationResponseSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  idempotent: z.boolean(),
  preparation: RunInputPreparationMetadataSchema,
});

export const PlaintextRunInputPayloadSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  preparationId: UuidSchema,
  workflowRunId: UuidSchema,
  workflowVersionId: UuidSchema,
  runnerDeviceId: UuidSchema,
  keyId: RunnerEncryptionKeyIdSchema,
  expiresAt: IsoDateSchema,
  inputs: WorkflowRunInputSubmissionSchema,
});

export const SecureRunInputEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(SECURE_RUN_INPUTS_SCHEMA_VERSION),
  profile: z.literal(SECURE_INPUT_ENVELOPE_PROFILE),
  contentEncryption: z.literal(CONTENT_ENCRYPTION_ALGORITHM),
  keyEncryption: z.literal(KEY_ENCRYPTION_ALGORITHM),
  preparationId: UuidSchema,
  workflowRunId: UuidSchema,
  keyId: RunnerEncryptionKeyIdSchema,
  expiresAt: IsoDateSchema,
  aad: Base64UrlSchema.max(16 * 1024),
  iv: Base64UrlSchema.refine(
    (value) => value.length === maxBase64UrlCharacters(AES_GCM_IV_BYTES),
    'The AES-GCM IV has an invalid length.',
  ),
  wrappedKey: Base64UrlSchema.max(
    maxBase64UrlCharacters(MAX_WRAPPED_KEY_BYTES),
  ),
  ciphertext: Base64UrlSchema.max(maxBase64UrlCharacters(MAX_CIPHERTEXT_BYTES)),
  ciphertextDigest: Sha256DigestSchema,
});

export const SafeSecureRunInputErrorCodeSchema = z.enum([
  'INVALID_SECURE_INPUT',
  'UNSUPPORTED_CRYPTO_PROFILE',
  'INVALID_KEY_METADATA',
  'KEY_NOT_FOUND',
  'KEY_CONFLICT',
  'PREPARATION_NOT_FOUND',
  'PREPARATION_EXPIRED',
  'PREPARATION_CONFLICT',
  'CAPABILITY_UNAVAILABLE',
  'FILE_INPUT_UNAVAILABLE',
  'ENVELOPE_TOO_LARGE',
  'ENVELOPE_BINDING_INVALID',
  'ENVELOPE_DIGEST_INVALID',
  'DECRYPTION_FAILED',
  'RUNTIME_INPUTS_INVALID',
  'SECRET_UNAVAILABLE',
  'SECRET_PROMPT_CANCELLED',
  'SECRET_PROMPT_TIMEOUT',
  'SENSITIVE_STATE_CLEANUP_FAILED',
]);

export const SafeSecureRunInputErrorSchema = z.strictObject({
  code: SafeSecureRunInputErrorCodeSchema,
  message: z.string().trim().min(1).max(200),
});

export const RuntimeInputValuesSchema = z.record(
  IdentifierSchema,
  RuntimeInputValueSchema,
);

export type RunnerCapability = z.infer<typeof RunnerCapabilitySchema>;
export type RunnerPublicKeyMetadata = z.infer<
  typeof RunnerPublicKeyMetadataSchema
>;
export type RunnerEncryptionKeyRegistrationRequest = z.infer<
  typeof RunnerEncryptionKeyRegistrationRequestSchema
>;
export type RunnerEncryptionKeyRegistrationResponse = z.infer<
  typeof RunnerEncryptionKeyRegistrationResponseSchema
>;
export type SecureVariableDefinition = z.infer<
  typeof SecureVariableDefinitionSchema
>;
export type SecureSecretRequirement = z.infer<
  typeof SecureSecretRequirementSchema
>;
export type SecureRunInputManifest = z.infer<
  typeof SecureRunInputManifestSchema
>;
export type RunInputAdditionalAuthenticatedData = z.infer<
  typeof RunInputAdditionalAuthenticatedDataSchema
>;
export type RunInputPreparationMetadata = z.infer<
  typeof RunInputPreparationMetadataSchema
>;
export type PlaintextRunInputPayload = z.infer<
  typeof PlaintextRunInputPayloadSchema
>;
export type SecureRunInputEnvelope = z.infer<
  typeof SecureRunInputEnvelopeSchema
>;
export type SafeSecureRunInputErrorCode = z.infer<
  typeof SafeSecureRunInputErrorCodeSchema
>;
