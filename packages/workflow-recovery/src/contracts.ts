import { z } from 'zod';

import {
  MAX_REPAIR_TIMEOUT_MS,
  MIN_REPAIR_TIMEOUT_MS,
  REPAIR_POLL_INTERVAL_SECONDS,
  WORKFLOW_RECOVERY_SCHEMA_VERSION,
} from './constants.js';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
const StepIdSchema = z.string().trim().min(1).max(256);
const ErrorCodeSchema = z.string().trim().min(1).max(80);

export const FailureCategorySchema = z.enum([
  'transient_read',
  'locator_resolution',
  'validation',
  'policy',
  'cancellation',
  'approval',
  'action',
  'navigation',
  'output',
  'infrastructure',
  'unknown',
]);

export const ExecutionEffectCertaintySchema = z.enum([
  'not_started',
  'read_only',
  'side_effect_possible',
  'completed',
  'unknown',
]);

export const RecoveryModeSchema = z.enum([
  'automatic_safe_only',
  'automatic_safe_and_manual',
  'automatic_safe_and_locator_proposals',
]);

export const RetryTriggerSchema = z.enum([
  'initial',
  'automatic_retry',
  'manual_retry',
]);

export const RetryDispositionSchema = z.enum([
  'none',
  'automatic_retry',
  'manual_repair',
  'locator_proposal',
  'new_run_required',
]);

export const StepAttemptStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
]);

export const RepairRequestStatusSchema = z.enum([
  'PENDING',
  'RETRY_APPROVED',
  'ABORTED',
  'EXPIRED',
  'CANCELLED',
  'INVALIDATED',
]);

export const RepairCoordinatorDecisionSchema = z.enum([
  'retry',
  'abort',
  'expired',
  'cancelled',
  'invalidated',
]);

export const RecoveryErrorCodeSchema = z.enum([
  'RECOVERY_NOT_ALLOWED',
  'RECOVERY_ATTEMPT_LIMIT_REACHED',
  'RECOVERY_COORDINATOR_UNAVAILABLE',
  'RECOVERY_REQUEST_FAILED',
  'RECOVERY_ABORTED',
  'RECOVERY_EXPIRED',
  'RECOVERY_INVALIDATED',
  'APPROVAL_GATED_RETRY_REQUIRES_NEW_RUN',
]);

export const SafeStepAttemptSchema = z
  .strictObject({
    attemptNumber: z.number().int().positive(),
    trigger: RetryTriggerSchema,
    status: StepAttemptStatusSchema,
    startedAt: IsoDateSchema,
    finishedAt: IsoDateSchema.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    errorCode: ErrorCodeSchema.optional(),
    effectCertainty: ExecutionEffectCertaintySchema,
    repairRequestId: UuidSchema.optional(),
  })
  .superRefine((attempt, context) => {
    if (attempt.status === 'running') {
      if (
        attempt.finishedAt !== undefined ||
        attempt.durationMs !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['finishedAt'],
          message: 'A running attempt must not be finished.',
        });
      }
    } else if (
      attempt.finishedAt === undefined ||
      attempt.durationMs === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'A terminal attempt requires safe timing metadata.',
      });
    }
    if (
      attempt.trigger === 'manual_retry' &&
      attempt.repairRequestId === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['repairRequestId'],
        message: 'A manual retry must reference an approved repair request.',
      });
    }
    if (
      attempt.trigger !== 'manual_retry' &&
      attempt.repairRequestId !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['repairRequestId'],
        message: 'Only manual retries may reference a repair request.',
      });
    }
  });

export const SafeStepAttemptListSchema = z
  .array(SafeStepAttemptSchema)
  .min(1)
  .max(3)
  .superRefine((attempts, context) => {
    let automaticRetries = 0;
    let manualRetries = 0;
    attempts.forEach((attempt, index) => {
      if (attempt.attemptNumber !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: [index, 'attemptNumber'],
          message: 'Attempt numbers must be continuous and begin at one.',
        });
      }
      if (index === 0 && attempt.trigger !== 'initial') {
        context.addIssue({
          code: 'custom',
          path: [index, 'trigger'],
          message: 'The first attempt must use the initial trigger.',
        });
      }
      if (index > 0 && attempt.trigger === 'initial') {
        context.addIssue({
          code: 'custom',
          path: [index, 'trigger'],
          message: 'Only the first attempt may use the initial trigger.',
        });
      }
      if (attempt.trigger === 'automatic_retry') automaticRetries += 1;
      if (attempt.trigger === 'manual_retry') manualRetries += 1;
    });
    if (automaticRetries > 1 || manualRetries > 1) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt retry limits were exceeded.',
      });
    }
  });

export const RetryPolicyInputSchema = z.strictObject({
  stepType: z.enum([
    'navigate',
    'click',
    'fill',
    'select',
    'setChecked',
    'wait',
    'extract',
    'verify',
    'approval',
  ]),
  errorCode: ErrorCodeSchema,
  effectCertainty: ExecutionEffectCertaintySchema,
  recoveryMode: RecoveryModeSchema,
  automaticRetryCount: z.number().int().nonnegative(),
  manualRetryCount: z.number().int().nonnegative(),
  totalAttemptCount: z.number().int().positive(),
  approvalGated: z.boolean(),
});

export const RetryPolicyDecisionSchema = z.strictObject({
  category: FailureCategorySchema,
  disposition: RetryDispositionSchema,
  retryAllowed: z.boolean(),
  recoveryErrorCode: RecoveryErrorCodeSchema.optional(),
});

export const RecoveryCoordinatorRequestSchema = z.strictObject({
  executionId: UuidSchema,
  workflowId: StepIdSchema,
  workflowVersion: z.number().int().positive(),
  stepId: StepIdSchema,
  stepIndex: z.number().int().nonnegative(),
  stepType: z.string().trim().min(1).max(32),
  attemptNumber: z.number().int().positive(),
  safeErrorCode: ErrorCodeSchema,
  effectCertainty: ExecutionEffectCertaintySchema,
  expiresAt: IsoDateSchema,
});

export const RecoveryCoordinatorResultSchema = z.strictObject({
  repairRequestId: UuidSchema,
  decision: RepairCoordinatorDecisionSchema,
  decidedAt: IsoDateSchema,
});

export const RunnerRepairRequestCreateSchema = z.strictObject({
  clientRequestId: UuidSchema,
  stepId: StepIdSchema,
  attemptNumber: z.number().int().positive().max(3),
  safeErrorCode: ErrorCodeSchema,
  effectCertainty: ExecutionEffectCertaintySchema,
  expiresAt: IsoDateSchema,
});

export const RunnerRepairRequestCreatedSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_RECOVERY_SCHEMA_VERSION),
  repairRequestId: UuidSchema,
  status: RepairRequestStatusSchema,
  retryAllowed: z.boolean(),
  requestedAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  pollAfterSeconds: z
    .number()
    .int()
    .positive()
    .max(30)
    .default(REPAIR_POLL_INTERVAL_SECONDS),
  idempotent: z.boolean(),
});

export const RunnerRepairStatusSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_RECOVERY_SCHEMA_VERSION),
  status: RepairRequestStatusSchema,
  retryAllowed: z.boolean(),
  requestedAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  resolvedAt: IsoDateSchema.nullable(),
  pollAfterSeconds: z.number().int().positive().max(30),
});

export const RepairDecisionRequestSchema = z.strictObject({
  clientDecisionId: UuidSchema,
});

export const SafeRepairRequestSchema = z.strictObject({
  id: UuidSchema,
  workspaceId: UuidSchema,
  workflowRunId: UuidSchema,
  workflowId: StepIdSchema,
  workflowName: z.string().trim().min(1).max(200),
  workflowVersion: z.number().int().positive(),
  runner: z.strictObject({
    id: UuidSchema,
    name: z.string().trim().min(1).max(100),
  }),
  step: z.strictObject({
    id: StepIdSchema,
    index: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(32),
  }),
  attemptNumber: z.number().int().positive().max(3),
  safeErrorCode: ErrorCodeSchema,
  effectCertainty: ExecutionEffectCertaintySchema,
  retryAllowed: z.boolean(),
  status: RepairRequestStatusSchema,
  requestedAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  resolvedAt: IsoDateSchema.nullable(),
});

const RepairAccessSchema = z.strictObject({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
  canRetry: z.boolean(),
  canAbort: z.boolean(),
});

export const RepairRequestListResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_RECOVERY_SCHEMA_VERSION),
  workspaceId: UuidSchema,
  access: RepairAccessSchema,
  requests: z.array(SafeRepairRequestSchema).max(1000),
});

export const RepairRequestDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_RECOVERY_SCHEMA_VERSION),
  access: RepairAccessSchema,
  request: SafeRepairRequestSchema,
});

export const RepairDecisionResponseSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_RECOVERY_SCHEMA_VERSION),
  idempotent: z.boolean(),
  request: SafeRepairRequestSchema,
});

export const RepairTimeoutMsSchema = z
  .number()
  .int()
  .min(MIN_REPAIR_TIMEOUT_MS)
  .max(MAX_REPAIR_TIMEOUT_MS);

export type FailureCategory = z.infer<typeof FailureCategorySchema>;
export type ExecutionEffectCertainty = z.infer<
  typeof ExecutionEffectCertaintySchema
>;
export type RecoveryMode = z.infer<typeof RecoveryModeSchema>;
export type RetryTrigger = z.infer<typeof RetryTriggerSchema>;
export type RetryDisposition = z.infer<typeof RetryDispositionSchema>;
export type StepAttemptStatus = z.infer<typeof StepAttemptStatusSchema>;
export type SafeStepAttempt = z.infer<typeof SafeStepAttemptSchema>;
export type RetryPolicyInput = z.infer<typeof RetryPolicyInputSchema>;
export type RetryPolicyDecision = z.infer<typeof RetryPolicyDecisionSchema>;
export type RepairRequestStatus = z.infer<typeof RepairRequestStatusSchema>;
export type RecoveryCoordinatorRequest = z.infer<
  typeof RecoveryCoordinatorRequestSchema
>;
export type RecoveryCoordinatorResult = z.infer<
  typeof RecoveryCoordinatorResultSchema
>;
export type RunnerRepairRequestCreate = z.infer<
  typeof RunnerRepairRequestCreateSchema
>;
export type RunnerRepairRequestCreated = z.infer<
  typeof RunnerRepairRequestCreatedSchema
>;
export type RunnerRepairStatus = z.infer<typeof RunnerRepairStatusSchema>;
export type SafeRepairRequest = z.infer<typeof SafeRepairRequestSchema>;
export type RepairRequestListResponse = z.infer<
  typeof RepairRequestListResponseSchema
>;
export type RepairRequestDetailResponse = z.infer<
  typeof RepairRequestDetailResponseSchema
>;
export type RepairDecisionResponse = z.infer<
  typeof RepairDecisionResponseSchema
>;
