import {
  WorkflowEngineExecutionOptionsSchema,
  WorkflowExecutionResultSchema,
  WorkflowProgressEventSchema,
} from '@tasktwin/workflow-engine';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import { SafeVerificationResultSchema } from '@tasktwin/workflow-verification';
import { SafeWorkflowOutputSummarySchema } from '@tasktwin/workflow-extraction';
import { SafeStepAttemptSchema } from '@tasktwin/workflow-recovery';
import {
  PolicyDecisionSchema,
  PolicyRiskLevelSchema,
  WorkflowPolicyEvaluationSchema,
  WorkspaceExecutionPolicyDefinitionSchema,
} from '@tasktwin/workflow-policy';
import {
  RunInputPreparationResponseSchema,
  RunInputAdditionalAuthenticatedDataSchema,
  SecureExecutionOptionsSchema,
  SecureRunInputEnvelopeSchema,
  SecureRunInputManifestSchema,
} from '@tasktwin/secure-run-inputs';
import { z } from 'zod';

import {
  DEFAULT_JOB_POLL_SECONDS,
  MAX_PROGRESS_BATCH_EVENTS,
  MAX_RUN_LIST_ITEMS,
  RUN_PROTOCOL_SCHEMA_VERSION,
  RUN_PROTOCOL_VERSION,
} from './constants.js';

export const UuidSchema = z.string().uuid();
export const IsoDateSchema = z.string().datetime({ offset: true });
export const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const LeaseTokenSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

export const WorkflowRunStatusSchema = z.enum([
  'QUEUED',
  'CLAIMED',
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'WAITING_FOR_REPAIR',
  'CANCEL_REQUESTED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'INTERRUPTED',
]);

export const PersistedRunStepStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'WAITING_FOR_REPAIR',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'SKIPPED',
  'INTERRUPTED',
]);

export const TerminalWorkflowRunStatusSchema = z.enum([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'INTERRUPTED',
]);

export const RunReadinessIssueCodeSchema = z.enum([
  'WORKFLOW_VERSION_NOT_PUBLISHED',
  'INVALID_WORKFLOW_DEFINITION',
  'RUNTIME_INPUT_REQUIRED',
  'SECRET_RESOLUTION_UNAVAILABLE',
  'FILE_INPUT_UNAVAILABLE',
  'UNSUPPORTED_STEP_TYPE',
  'FIRST_STEP_MUST_NAVIGATE',
  'NAVIGATION_URL_MUST_BE_LITERAL',
  'INVALID_NAVIGATION_URL',
  'NO_ALLOWED_ORIGIN',
  'RUNNER_CAPABILITY_UNAVAILABLE',
]);

export const RunReadinessIssueSchema = z.strictObject({
  code: RunReadinessIssueCodeSchema,
  message: z.string().trim().min(1).max(240),
  stepId: z.string().trim().min(1).optional(),
  stepIndex: z.number().int().nonnegative().optional(),
});

export const WorkflowRunReadinessReportSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  ready: z.boolean(),
  allowedOrigins: z.array(z.string().url().max(512)).max(32),
  issues: z.array(RunReadinessIssueSchema),
});

export const CreateWorkflowRunRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  clientRunId: UuidSchema,
  runnerDeviceId: UuidSchema,
  options: WorkflowEngineExecutionOptionsSchema.default({
    totalTimeoutMs: 300_000,
    stepTimeoutMs: 30_000,
    recoveryMode: 'automatic_safe_only',
  }),
});

export const CreateRunInputPreparationRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  clientPreparationId: UuidSchema,
  clientRunId: UuidSchema,
  runnerDeviceId: UuidSchema,
  options: SecureExecutionOptionsSchema,
});

export { RunInputPreparationResponseSchema };

export const CommitRunInputPreparationRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  envelope: SecureRunInputEnvelopeSchema,
});

export const SafeRunStepMetadataSchema = z.strictObject({
  stepId: z.string().trim().min(1).max(256),
  stepIndex: z.number().int().nonnegative(),
  stepType: z.string().trim().min(1).max(32),
  status: PersistedRunStepStatusSchema,
  startedAt: IsoDateSchema.nullable(),
  finishedAt: IsoDateSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  errorCode: z.string().trim().min(1).max(80).nullable(),
  skippedReason: z.string().trim().min(1).max(80).nullable(),
  verification: SafeVerificationResultSchema.optional(),
  attempts: z.array(SafeStepAttemptSchema).max(3).default([]),
});

export const SafeRunOutputMetadataSchema =
  SafeWorkflowOutputSummarySchema.extend({
    producerStepIndex: z.number().int().nonnegative(),
    producedAt: IsoDateSchema.nullable(),
  });

export const SafeWorkflowRunMetadataSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  workflowId: z.string().trim().min(1).max(256),
  workflowVersionId: UuidSchema,
  workflowVersion: z.number().int().positive(),
  runnerDeviceId: UuidSchema,
  createdByUserId: UuidSchema,
  clientRunId: UuidSchema,
  status: WorkflowRunStatusSchema,
  definitionDigest: Sha256DigestSchema,
  policyVersionId: UuidSchema.nullable(),
  policyDigest: Sha256DigestSchema.nullable(),
  policyDecision: PolicyDecisionSchema.nullable(),
  policyHighestRisk: PolicyRiskLevelSchema.nullable(),
  stepCount: z.number().int().nonnegative(),
  lastProgressSequence: z.number().int().nonnegative(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  claimedAt: IsoDateSchema.nullable(),
  startedAt: IsoDateSchema.nullable(),
  cancelRequestedAt: IsoDateSchema.nullable(),
  finishedAt: IsoDateSchema.nullable(),
  terminationCause: z.string().trim().min(1).max(80).nullable(),
});

export const WorkflowRunDetailSchema = SafeWorkflowRunMetadataSchema.extend({
  steps: z.array(SafeRunStepMetadataSchema),
  outputs: z.array(SafeRunOutputMetadataSchema),
});

export const CreateWorkflowRunResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  idempotent: z.boolean(),
  run: WorkflowRunDetailSchema,
});

export const WorkflowRunListResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  workspaceId: UuidSchema,
  access: z.strictObject({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
    canCreate: z.boolean(),
    canCancel: z.boolean(),
  }),
  runs: z.array(SafeWorkflowRunMetadataSchema).max(MAX_RUN_LIST_ITEMS),
});

export const WorkflowRunDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  access: z.strictObject({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
    canCancel: z.boolean(),
  }),
  run: WorkflowRunDetailSchema,
});

export const RunnerJobClaimRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  runProtocolVersion: z.literal(RUN_PROTOCOL_VERSION),
  workflowEngineSchemaVersion: z.literal(1),
  runnerVersion: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/),
  claimAttemptId: UuidSchema,
});

export const ClaimedRunInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('encrypted_envelope'),
    envelope: SecureRunInputEnvelopeSchema,
    aad: RunInputAdditionalAuthenticatedDataSchema,
    manifest: SecureRunInputManifestSchema,
  }),
]);

export const ClaimedRunnerJobSchema = z.strictObject({
  runId: UuidSchema,
  definitionDigest: Sha256DigestSchema,
  workflow: WorkflowDefinitionSchema,
  policy: z.strictObject({
    versionId: UuidSchema,
    revision: z.number().int().positive(),
    digest: Sha256DigestSchema,
    definition: WorkspaceExecutionPolicyDefinitionSchema,
    evaluation: WorkflowPolicyEvaluationSchema,
  }),
  runtimeInput: ClaimedRunInputSchema,
  allowedOrigins: z.array(z.string().url().max(512)).min(1).max(32),
  options: WorkflowEngineExecutionOptionsSchema,
  leaseToken: LeaseTokenSchema,
  leaseExpiresAt: IsoDateSchema,
  renewAfterSeconds: z.number().int().positive().max(300),
});

export const RunnerJobClaimResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
    status: z.literal('no_job'),
    pollAfterSeconds: z
      .number()
      .int()
      .positive()
      .max(300)
      .default(DEFAULT_JOB_POLL_SECONDS),
  }),
  z.strictObject({
    schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
    status: z.literal('claimed'),
    job: ClaimedRunnerJobSchema,
  }),
]);

export const LeaseRenewalRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
});

export const LeaseRenewalResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  leaseExpiresAt: IsoDateSchema,
  renewAfterSeconds: z.number().int().positive().max(300),
  cancelRequested: z.boolean(),
});

export const SequencedWorkflowProgressEventSchema = z.strictObject({
  sequence: z.number().int().positive(),
  event: WorkflowProgressEventSchema,
});

export const WorkflowProgressBatchSchema = z
  .strictObject({
    schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
    clientBatchId: UuidSchema,
    firstSequence: z.number().int().positive(),
    lastSequence: z.number().int().positive(),
    events: z
      .array(SequencedWorkflowProgressEventSchema)
      .min(1)
      .max(MAX_PROGRESS_BATCH_EVENTS),
  })
  .superRefine((batch, context) => {
    if (batch.events.length !== batch.lastSequence - batch.firstSequence + 1) {
      context.addIssue({
        code: 'custom',
        path: ['lastSequence'],
        message: 'Progress range must equal the event count.',
      });
    }
    batch.events.forEach((item, index) => {
      if (item.sequence !== batch.firstSequence + index) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sequence'],
          message: 'Progress sequences must be contiguous.',
        });
      }
    });
  });

export const WorkflowProgressBatchResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  acceptedThroughSequence: z.number().int().positive(),
  idempotent: z.boolean(),
  cancelRequested: z.boolean(),
});

export const WorkflowRunCompletionRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  clientCompletionId: UuidSchema,
  result: WorkflowExecutionResultSchema,
});

export const WorkflowRunCompletionResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  idempotent: z.boolean(),
  run: WorkflowRunDetailSchema,
});

export const WorkflowRunCancellationRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
});

export const WorkflowRunCancellationResponseSchema = z.strictObject({
  schemaVersion: z.literal(RUN_PROTOCOL_SCHEMA_VERSION),
  idempotent: z.boolean(),
  run: WorkflowRunDetailSchema,
});

export const SafeRunProtocolErrorSchema = z.strictObject({
  code: z.enum([
    'INVALID_REQUEST',
    'RUN_NOT_READY',
    'RUN_NOT_FOUND',
    'RUN_FORBIDDEN',
    'RUN_CONFLICT',
    'RUN_TERMINAL',
    'RUNNER_MISMATCH',
    'LEASE_INVALID',
    'LEASE_EXPIRED',
    'PROGRESS_SEQUENCE_INVALID',
    'PROGRESS_TRANSITION_INVALID',
    'PROGRESS_BATCH_CONFLICT',
    'COMPLETION_INVALID',
    'COMPLETION_CONFLICT',
    'TEMPORARILY_UNAVAILABLE',
  ]),
  message: z.string().trim().min(1).max(200),
});

export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;
export type PersistedRunStepStatus = z.infer<
  typeof PersistedRunStepStatusSchema
>;
export type WorkflowRunReadinessReport = z.infer<
  typeof WorkflowRunReadinessReportSchema
>;
export type CreateWorkflowRunRequest = z.infer<
  typeof CreateWorkflowRunRequestSchema
>;
export type CreateRunInputPreparationRequest = z.infer<
  typeof CreateRunInputPreparationRequestSchema
>;
export type CommitRunInputPreparationRequest = z.infer<
  typeof CommitRunInputPreparationRequestSchema
>;
export type SafeWorkflowRunMetadata = z.infer<
  typeof SafeWorkflowRunMetadataSchema
>;
export type WorkflowRunDetail = z.infer<typeof WorkflowRunDetailSchema>;
export type RunnerJobClaimRequest = z.infer<typeof RunnerJobClaimRequestSchema>;
export type RunnerJobClaimResponse = z.infer<
  typeof RunnerJobClaimResponseSchema
>;
export type ClaimedRunnerJob = z.infer<typeof ClaimedRunnerJobSchema>;
export type ClaimedRunInput = z.infer<typeof ClaimedRunInputSchema>;
export type LeaseRenewalResponse = z.infer<typeof LeaseRenewalResponseSchema>;
export type SequencedWorkflowProgressEvent = z.infer<
  typeof SequencedWorkflowProgressEventSchema
>;
export type WorkflowProgressBatch = z.infer<typeof WorkflowProgressBatchSchema>;
export type WorkflowRunCompletionRequest = z.infer<
  typeof WorkflowRunCompletionRequestSchema
>;
export type WorkflowRunCompletionResponse = z.infer<
  typeof WorkflowRunCompletionResponseSchema
>;
