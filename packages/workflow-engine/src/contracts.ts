import { WorkflowRunInputSubmissionSchema } from '@tasktwin/workflow-inputs';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import { SafeVerificationResultSchema } from '@tasktwin/workflow-verification';
import { SafeWorkflowOutputSummarySchema } from '@tasktwin/workflow-extraction';
import { z } from 'zod';

import {
  MAX_ALLOWED_ORIGINS,
  MAX_EXECUTION_TIMEOUT_MS,
  MAX_SAFE_MESSAGE_LENGTH,
  MAX_STEP_TIMEOUT_MS,
  MIN_EXECUTION_TIMEOUT_MS,
  MIN_STEP_TIMEOUT_MS,
  WORKFLOW_ENGINE_SCHEMA_VERSION,
} from './constants.js';

export const WorkflowStepTypeSchema = z.enum([
  'navigate',
  'click',
  'fill',
  'select',
  'setChecked',
  'wait',
  'extract',
  'verify',
  'approval',
]);

export const WorkflowEngineRunStatusSchema = z.enum([
  'pending',
  'validating',
  'starting',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);

export const TerminalRunStatusSchema = z.enum([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);

export const WorkflowEngineStepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'skipped',
]);

export const TerminalStepStatusSchema = z.enum([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'skipped',
]);

export const SkippedStepReasonSchema = z.enum([
  'preflight_failed',
  'adapter_start_failed',
  'prior_step_failed',
  'previous_step_failed',
  'run_cancelled',
  'run_timed_out',
]);

export const TerminationCauseSchema = z.enum([
  'completed',
  'preflight_failed',
  'adapter_start_failed',
  'step_failed',
  'step_timeout',
  'run_cancelled',
  'total_timeout',
  'cleanup_failed',
]);

export const ExecutionErrorCodeSchema = z.enum([
  'INVALID_EXECUTION_REQUEST',
  'INVALID_WORKFLOW',
  'INVALID_RUNTIME_INPUTS',
  'INVALID_EXECUTION_TIMEOUT',
  'UNSUPPORTED_STEP_TYPE',
  'SECRET_RESOLUTION_UNAVAILABLE',
  'INVALID_NAVIGATION_URL',
  'UNSAFE_URL_SCHEME',
  'ORIGIN_NOT_ALLOWED',
  'POST_NAVIGATION_ORIGIN_NOT_ALLOWED',
  'UNSUPPORTED_LOCATOR',
  'UNSUPPORTED_ROLE',
  'LOCATOR_NOT_FOUND',
  'LOCATOR_NOT_UNIQUE',
  'BROWSER_LAUNCH_FAILED',
  'BROWSER_CONTEXT_FAILED',
  'ADAPTER_START_FAILED',
  'NAVIGATION_TIMEOUT',
  'ACTION_TIMEOUT',
  'STEP_TIMEOUT',
  'TOTAL_EXECUTION_TIMEOUT',
  'ACTION_FAILED',
  'EXECUTION_CANCELLED',
  'RESOURCE_CLEANUP_FAILED',
  'INVALID_RUN_TRANSITION',
  'INVALID_STEP_TRANSITION',
  'VERIFICATION_RULE_INVALID',
  'VERIFICATION_EXPECTATION_INVALID',
  'VERIFICATION_NOT_MATCHED',
  'VERIFICATION_TARGET_UNSUPPORTED',
  'OUTPUT_NOT_AVAILABLE',
  'OUTPUT_TYPE_MISMATCH',
  'DUPLICATE_OUTPUT_PRODUCTION',
  'EXTRACTION_TARGET_UNSUPPORTED',
  'EXTRACTION_VALUE_UNAVAILABLE',
]);

export const SafeExecutionErrorSchema = z.strictObject({
  code: ExecutionErrorCodeSchema,
  message: z.string().trim().min(1).max(MAX_SAFE_MESSAGE_LENGTH),
});

export const WorkflowEngineWarningCodeSchema = z.enum([
  'PROGRESS_SINK_FAILED',
  'RESOURCE_CLEANUP_FAILED',
]);

export const WorkflowEngineWarningSchema = z.strictObject({
  code: WorkflowEngineWarningCodeSchema,
  message: z.string().trim().min(1).max(MAX_SAFE_MESSAGE_LENGTH),
});

export const WorkflowEngineExecutionOptionsSchema = z.strictObject({
  totalTimeoutMs: z
    .number()
    .int()
    .min(MIN_EXECUTION_TIMEOUT_MS)
    .max(MAX_EXECUTION_TIMEOUT_MS),
  stepTimeoutMs: z
    .number()
    .int()
    .min(MIN_STEP_TIMEOUT_MS)
    .max(MAX_STEP_TIMEOUT_MS),
});

export const AllowedOriginSchema = z.string().trim().min(1).max(512);

export const WorkflowExecutionRequestSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_ENGINE_SCHEMA_VERSION),
  workflow: WorkflowDefinitionSchema,
  inputs: WorkflowRunInputSubmissionSchema,
  allowedOrigins: z.array(AllowedOriginSchema).min(1).max(MAX_ALLOWED_ORIGINS),
  options: WorkflowEngineExecutionOptionsSchema,
});

export const StepExecutionResultSchema = z
  .strictObject({
    stepId: z.string().trim().min(1),
    stepType: WorkflowStepTypeSchema,
    status: TerminalStepStatusSchema,
    startedAt: z.string().datetime({ offset: true }).optional(),
    finishedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().nonnegative(),
    locatorKind: z
      .enum(['testId', 'role', 'label', 'placeholder', 'text', 'css'])
      .optional(),
    skippedReason: SkippedStepReasonSchema.optional(),
    error: SafeExecutionErrorSchema.optional(),
    verification: SafeVerificationResultSchema.optional(),
  })
  .superRefine((result, context) => {
    if (result.status === 'skipped' && result.skippedReason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['skippedReason'],
        message: 'A skipped step requires a reason.',
      });
    }
    if (result.status !== 'skipped' && result.skippedReason !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['skippedReason'],
        message: 'Only skipped steps may include a skipped reason.',
      });
    }
    if (result.status === 'skipped' && result.startedAt !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message: 'A skipped step must not have a start timestamp.',
      });
    }
  });

export const StepCountSummarySchema = z
  .strictObject({
    total: z.number().int().nonnegative(),
    attempted: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    timedOut: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .superRefine((counts, context) => {
    if (
      counts.succeeded +
        counts.failed +
        counts.cancelled +
        counts.timedOut +
        counts.skipped !==
      counts.total
    ) {
      context.addIssue({
        code: 'custom',
        path: ['total'],
        message: 'Categorized step counts must equal the total.',
      });
    }
    if (counts.attempted + counts.skipped !== counts.total) {
      context.addIssue({
        code: 'custom',
        path: ['attempted'],
        message: 'Attempted and skipped counts must equal the total.',
      });
    }
  });

export const WorkflowExecutionResultSchema = z
  .strictObject({
    schemaVersion: z.literal(WORKFLOW_ENGINE_SCHEMA_VERSION),
    executionId: z.string().uuid(),
    workflowId: z.string().trim().min(1).nullable(),
    workflowVersion: z.number().int().positive().nullable(),
    status: TerminalRunStatusSchema,
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().nonnegative(),
    terminationCause: TerminationCauseSchema,
    counts: StepCountSummarySchema,
    failedStepId: z.string().trim().min(1).optional(),
    error: SafeExecutionErrorSchema.optional(),
    warnings: z.array(WorkflowEngineWarningSchema),
    steps: z.array(StepExecutionResultSchema),
    outputs: z.array(SafeWorkflowOutputSummarySchema).default([]),
  })
  .superRefine((result, context) => {
    if (result.steps.length !== result.counts.total) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'The result must contain every declared step.',
      });
    }
    const actual = {
      succeeded: result.steps.filter((step) => step.status === 'succeeded')
        .length,
      failed: result.steps.filter((step) => step.status === 'failed').length,
      cancelled: result.steps.filter((step) => step.status === 'cancelled')
        .length,
      timedOut: result.steps.filter((step) => step.status === 'timed_out')
        .length,
      skipped: result.steps.filter((step) => step.status === 'skipped').length,
    };
    for (const [name, count] of Object.entries(actual)) {
      if (result.counts[name as keyof typeof actual] !== count) {
        context.addIssue({
          code: 'custom',
          path: ['counts', name],
          message: 'The categorized count does not match the step results.',
        });
      }
    }
  });

const ProgressEventBaseSchema = z.strictObject({
  executionId: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
});

export const RunStatusProgressEventSchema = ProgressEventBaseSchema.extend({
  kind: z.literal('run_status_changed'),
  status: WorkflowEngineRunStatusSchema,
  errorCode: ExecutionErrorCodeSchema.optional(),
});

export const StepStatusProgressEventSchema = ProgressEventBaseSchema.extend({
  kind: z.literal('step_status_changed'),
  stepId: z.string().trim().min(1),
  stepType: WorkflowStepTypeSchema,
  status: WorkflowEngineStepStatusSchema,
  errorCode: ExecutionErrorCodeSchema.optional(),
  skippedReason: SkippedStepReasonSchema.optional(),
});

export const WarningProgressEventSchema = ProgressEventBaseSchema.extend({
  kind: z.literal('warning'),
  warningCode: WorkflowEngineWarningCodeSchema,
});

export const OutputProducedProgressEventSchema = ProgressEventBaseSchema.extend(
  {
    kind: z.literal('output_produced'),
    producerStepId: z.string().trim().min(1).max(256),
    outputName: z.string().trim().min(1),
    outputType: z.enum(['string', 'boolean']),
  },
);

export const WorkflowProgressEventSchema = z.discriminatedUnion('kind', [
  RunStatusProgressEventSchema,
  StepStatusProgressEventSchema,
  OutputProducedProgressEventSchema,
  WarningProgressEventSchema,
]);

export type WorkflowStepType = z.infer<typeof WorkflowStepTypeSchema>;
export type WorkflowEngineRunStatus = z.infer<
  typeof WorkflowEngineRunStatusSchema
>;
export type TerminalRunStatus = z.infer<typeof TerminalRunStatusSchema>;
export type WorkflowEngineStepStatus = z.infer<
  typeof WorkflowEngineStepStatusSchema
>;
export type TerminalStepStatus = z.infer<typeof TerminalStepStatusSchema>;
export type SkippedStepReason = z.infer<typeof SkippedStepReasonSchema>;
export type TerminationCause = z.infer<typeof TerminationCauseSchema>;
export type ExecutionErrorCode = z.infer<typeof ExecutionErrorCodeSchema>;
export type SafeExecutionError = z.infer<typeof SafeExecutionErrorSchema>;
export type WorkflowEngineWarning = z.infer<typeof WorkflowEngineWarningSchema>;
export type WorkflowEngineExecutionOptions = z.infer<
  typeof WorkflowEngineExecutionOptionsSchema
>;
export type WorkflowExecutionRequest = z.infer<
  typeof WorkflowExecutionRequestSchema
>;
export type StepExecutionResult = z.infer<typeof StepExecutionResultSchema>;
export type StepCountSummary = z.infer<typeof StepCountSummarySchema>;
export type WorkflowExecutionResult = z.infer<
  typeof WorkflowExecutionResultSchema
>;
export type WorkflowProgressEvent = z.infer<typeof WorkflowProgressEventSchema>;
