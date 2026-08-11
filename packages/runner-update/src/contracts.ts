import {
  ProductSemVerSchema,
  ReleaseArtifactDescriptorSchema,
  ReleaseManifestSchema,
  RunnerReleaseArchitectureSchema,
  RunnerReleaseIdSchema,
  RunnerReleasePlatformSchema,
  RunnerSoftwareIdentitySchema,
  Sha256HexSchema,
  SourceCommitSchema,
  expectedRunnerArtifactFileName,
  deriveRunnerReleaseId,
  type RunnerReleaseId,
} from '@tasktwin/runner-release';
import { z } from 'zod';

import {
  RUNNER_ACTIVE_RELEASE_SCHEMA_VERSION,
  RUNNER_INSTALLED_RELEASE_SCHEMA_VERSION,
  RUNNER_RELEASE_ID_PREFIX,
  RUNNER_STARTUP_STATUS_SCHEMA_VERSION,
  RUNNER_UPDATE_ID_PREFIX,
  RUNNER_UPDATE_SCHEMA_VERSION,
} from './constants.js';
import { RunnerUpdateErrorCodeSchema } from './errors.js';

const MAX_REVISION = 2_147_483_647;

function isNormalizedUtcTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export const RunnerUpdateTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    isNormalizedUtcTimestamp,
    'Timestamp must be normalized UTC ISO-8601.',
  );

export const RunnerUpdateIdSchema = z
  .string()
  .regex(new RegExp(`^${RUNNER_UPDATE_ID_PREFIX}[0-9a-f]{64}$`));

export const RunnerActivationIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/);

export const RunnerStartupAttemptIdSchema = RunnerActivationIdSchema;

export const RunnerUpdateOperationSchema = z.enum([
  'apply',
  'manual_rollback',
  'recover',
]);

export const RunnerUpdateStateSchema = z.enum([
  'idle',
  'preparing',
  'draining',
  'staging',
  'ready_to_switch',
  'switching',
  'starting_target',
  'verifying_target',
  'succeeded',
  'failed_before_switch',
  'rolling_back',
  'rolled_back',
  'manual_recovery_required',
]);

const RunnerUpdateJournalObjectSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_UPDATE_SCHEMA_VERSION),
  revision: z.number().int().positive().max(MAX_REVISION),
  operation: RunnerUpdateOperationSchema,
  updateId: RunnerUpdateIdSchema,
  state: RunnerUpdateStateSchema,
  sourceReleaseId: RunnerReleaseIdSchema,
  targetReleaseId: RunnerReleaseIdSchema,
  fromVersion: ProductSemVerSchema,
  targetVersion: ProductSemVerSchema,
  sourceManifestSha256: Sha256HexSchema,
  targetManifestSha256: Sha256HexSchema,
  sourceArtifactSha256: Sha256HexSchema,
  targetArtifactSha256: Sha256HexSchema,
  startedAt: RunnerUpdateTimestampSchema,
  updatedAt: RunnerUpdateTimestampSchema,
  failureCode: RunnerUpdateErrorCodeSchema.optional(),
});

const STATES_ALLOWING_FAILURE_CODE = new Set<RunnerUpdateState>([
  'rolling_back',
  'rolled_back',
  'failed_before_switch',
  'manual_recovery_required',
]);

export const RunnerUpdateJournalSchema =
  RunnerUpdateJournalObjectSchema.superRefine((journal, context) => {
    if (journal.sourceReleaseId === journal.targetReleaseId) {
      context.addIssue({
        code: 'custom',
        message: 'Source and target release IDs must differ.',
        path: ['targetReleaseId'],
      });
    }
    if (journal.updatedAt < journal.startedAt) {
      context.addIssue({
        code: 'custom',
        message: 'The update timestamp cannot precede its start timestamp.',
        path: ['updatedAt'],
      });
    }
    if (
      (journal.state === 'failed_before_switch' ||
        journal.state === 'manual_recovery_required') &&
      journal.failureCode === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A failed update state requires a stable failure code.',
        path: ['failureCode'],
      });
    }
    if (
      journal.failureCode !== undefined &&
      !STATES_ALLOWING_FAILURE_CODE.has(journal.state)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'This update state cannot carry a failure code.',
        path: ['failureCode'],
      });
    }
  });

export const InstalledReleaseRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(RUNNER_INSTALLED_RELEASE_SCHEMA_VERSION),
    releaseId: RunnerReleaseIdSchema,
    product: ReleaseManifestSchema.shape.product,
    version: ProductSemVerSchema,
    sourceCommit: SourceCommitSchema,
    platform: RunnerReleasePlatformSchema,
    architecture: RunnerReleaseArchitectureSchema,
    signingKeyId: ReleaseManifestSchema.shape.signingKeyId,
    manifestSha256: Sha256HexSchema,
    artifact: ReleaseArtifactDescriptorSchema,
    installedAt: RunnerUpdateTimestampSchema,
  })
  .superRefine((record, context) => {
    if (
      record.artifact.platform !== record.platform ||
      record.artifact.architecture !== record.architecture
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The retained artifact target must match the release target.',
        path: ['artifact'],
      });
    }
    const expectedReleaseId = `${RUNNER_RELEASE_ID_PREFIX}${record.manifestSha256}`;
    if (record.releaseId !== expectedReleaseId) {
      context.addIssue({
        code: 'custom',
        message: 'The release ID must be derived from the manifest digest.',
        path: ['releaseId'],
      });
    }
    const expectedArtifactName = expectedRunnerArtifactFileName(
      record.version,
      record.platform,
      record.architecture,
    );
    if (record.artifact.fileName !== expectedArtifactName) {
      context.addIssue({
        code: 'custom',
        message: `The retained artifact name must be ${expectedArtifactName}.`,
        path: ['artifact', 'fileName'],
      });
    }
  });

export const ActiveReleaseRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(RUNNER_ACTIVE_RELEASE_SCHEMA_VERSION),
    generation: z.number().int().positive().max(MAX_REVISION),
    currentReleaseId: RunnerReleaseIdSchema,
    previousReleaseId: RunnerReleaseIdSchema.nullable(),
    currentActivationId: RunnerActivationIdSchema,
    activatedAt: RunnerUpdateTimestampSchema,
  })
  .superRefine((record, context) => {
    if (record.previousReleaseId === record.currentReleaseId) {
      context.addIssue({
        code: 'custom',
        message: 'Current and previous release IDs must differ.',
        path: ['previousReleaseId'],
      });
    }
  });

export const RunnerComponentCheckSchema = z.enum([
  'pending',
  'passed',
  'failed',
]);

export const RunnerNativeUnlockCheckSchema = z.enum([
  'not_required',
  'pending',
  'passed',
  'failed',
]);

export const RunnerControlPlaneAcknowledgementSchema = z.enum([
  'not_attempted',
  'offline',
  'compatible',
  'update_recommended',
  'update_required',
  'unsupported',
]);

export const RunnerStartupStateSchema = z.enum([
  'starting',
  'healthy',
  'draining',
  'stopped',
  'failed',
]);

export const RunnerStartupStatusSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_STARTUP_STATUS_SCHEMA_VERSION),
  activationId: RunnerActivationIdSchema,
  startupAttemptId: RunnerStartupAttemptIdSchema,
  softwareIdentity: RunnerSoftwareIdentitySchema,
  state: RunnerStartupStateSchema,
  observedAt: RunnerUpdateTimestampSchema,
  acceptsNewJobs: z.boolean(),
  activeWork: z.boolean(),
  checks: z.strictObject({
    identity: RunnerComponentCheckSchema,
    instanceLock: RunnerComponentCheckSchema,
    workflowEngine: RunnerComponentCheckSchema,
    policyRuntime: RunnerComponentCheckSchema,
    chromium: RunnerComponentCheckSchema,
    localSecretStore: RunnerComponentCheckSchema,
    nativeSecretAutoUnlock: RunnerNativeUnlockCheckSchema,
  }),
  controlPlaneAcknowledgement: RunnerControlPlaneAcknowledgementSchema,
});

export { RunnerReleaseIdSchema, deriveRunnerReleaseId };

export type RunnerUpdateOperation = z.infer<typeof RunnerUpdateOperationSchema>;
export type RunnerUpdateState = z.infer<typeof RunnerUpdateStateSchema>;
export type RunnerUpdateJournal = z.infer<typeof RunnerUpdateJournalSchema>;
export type InstalledReleaseRecord = z.infer<
  typeof InstalledReleaseRecordSchema
>;
export type ActiveReleaseRecord = z.infer<typeof ActiveReleaseRecordSchema>;
export type { RunnerReleaseId };
export type RunnerUpdateId = z.infer<typeof RunnerUpdateIdSchema>;
export type RunnerActivationId = z.infer<typeof RunnerActivationIdSchema>;
export type RunnerStartupAttemptId = z.infer<
  typeof RunnerStartupAttemptIdSchema
>;
export type RunnerComponentCheck = z.infer<typeof RunnerComponentCheckSchema>;
export type RunnerNativeUnlockCheck = z.infer<
  typeof RunnerNativeUnlockCheckSchema
>;
export type RunnerControlPlaneAcknowledgement = z.infer<
  typeof RunnerControlPlaneAcknowledgementSchema
>;
export type RunnerStartupState = z.infer<typeof RunnerStartupStateSchema>;
export type RunnerStartupStatus = z.infer<typeof RunnerStartupStatusSchema>;
