import {
  MAX_WAIT_DURATION_MS,
  WorkflowDefinitionSchema,
} from '@tasktwin/workflow-schema';
import { WorkflowRunInputSubmissionSchema } from '@tasktwin/workflow-inputs';
import { z } from 'zod';

export const LOCAL_EXECUTION_SCHEMA_VERSION = 1;
export const MAX_ALLOWED_ORIGINS = 32;
export const MIN_TIMEOUT_MS = 100;
export const MAX_ACTION_TIMEOUT_MS = 30_000;
export const MAX_NAVIGATION_TIMEOUT_MS = 60_000;
export const MAX_EXECUTION_TIMEOUT_MS = 600_000;

export const SupportedExecutionStepTypeSchema = z.enum([
  'navigate',
  'click',
  'fill',
  'select',
  'setChecked',
  'wait',
]);

export const ExecutionErrorCodeSchema = z.enum([
  'INVALID_EXECUTION_REQUEST',
  'INVALID_WORKFLOW',
  'INVALID_RUNTIME_INPUTS',
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
  'NAVIGATION_TIMEOUT',
  'ACTION_TIMEOUT',
  'ACTION_FAILED',
  'EXECUTION_CANCELLED',
  'RESOURCE_CLEANUP_FAILED',
]);

export const SafeExecutionErrorSchema = z.strictObject({
  code: ExecutionErrorCodeSchema,
  message: z.string().trim().min(1).max(200),
});

export const BrowserExecutionOptionsSchema = z.strictObject({
  headless: z.boolean().default(true),
  actionTimeoutMs: z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS)
    .max(MAX_ACTION_TIMEOUT_MS)
    .default(10_000),
  navigationTimeoutMs: z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS)
    .max(MAX_NAVIGATION_TIMEOUT_MS)
    .default(30_000),
  executionTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(MAX_EXECUTION_TIMEOUT_MS)
    .default(MAX_EXECUTION_TIMEOUT_MS),
});

export const AllowedOriginSchema = z.string().trim().min(1).max(512);

export const LocalExecutionRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(LOCAL_EXECUTION_SCHEMA_VERSION),
    workflow: WorkflowDefinitionSchema,
    inputs: WorkflowRunInputSubmissionSchema,
    allowedOrigins: z
      .array(AllowedOriginSchema)
      .min(1)
      .max(MAX_ALLOWED_ORIGINS),
    options: BrowserExecutionOptionsSchema,
  })
  .superRefine((request, context) => {
    const normalized = new Set<string>();
    request.allowedOrigins.forEach((value, index) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['allowedOrigins', index],
          message: 'Allowed origin is invalid.',
        });
        return;
      }
      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username !== '' ||
        url.password !== '' ||
        url.pathname !== '/' ||
        url.search !== '' ||
        url.hash !== ''
      ) {
        context.addIssue({
          code: 'custom',
          path: ['allowedOrigins', index],
          message: 'Allowed origin must be an HTTP or HTTPS origin.',
        });
        return;
      }
      if (normalized.has(url.origin)) {
        context.addIssue({
          code: 'custom',
          path: ['allowedOrigins', index],
          message: 'Allowed origins must be unique.',
        });
      }
      normalized.add(url.origin);
    });
  });

export const WorkflowExecutionContextMetadataSchema = z.strictObject({
  executionId: z.string().uuid(),
  workflowId: z.string().trim().min(1),
  workflowVersion: z.number().int().positive(),
  startedAt: z.string().datetime({ offset: true }),
  declaredStepCount: z.number().int().nonnegative(),
  allowedOriginCount: z.number().int().positive().max(MAX_ALLOWED_ORIGINS),
});

export const StepExecutionResultSchema = z.strictObject({
  stepId: z.string().trim().min(1),
  stepType: SupportedExecutionStepTypeSchema,
  status: z.enum(['succeeded', 'failed']),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
  locatorKind: z
    .enum(['testId', 'role', 'label', 'placeholder', 'text', 'css'])
    .optional(),
  error: SafeExecutionErrorSchema.optional(),
});

export const LocalWorkflowExecutionResultSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_EXECUTION_SCHEMA_VERSION),
  context: WorkflowExecutionContextMetadataSchema,
  status: z.enum(['succeeded', 'failed']),
  finishedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
  attemptedStepCount: z.number().int().nonnegative(),
  failedStepId: z.string().trim().min(1).optional(),
  steps: z.array(StepExecutionResultSchema),
  cleanupError: SafeExecutionErrorSchema.optional(),
});

export const ExecutionWaitDurationSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_WAIT_DURATION_MS);

export type BrowserExecutionOptions = z.infer<
  typeof BrowserExecutionOptionsSchema
>;
export type ExecutionErrorCode = z.infer<typeof ExecutionErrorCodeSchema>;
export type SafeExecutionError = z.infer<typeof SafeExecutionErrorSchema>;
export type LocalExecutionRequest = z.infer<typeof LocalExecutionRequestSchema>;
export type WorkflowExecutionContextMetadata = z.infer<
  typeof WorkflowExecutionContextMetadataSchema
>;
export type StepExecutionResult = z.infer<typeof StepExecutionResultSchema>;
export type LocalWorkflowExecutionResult = z.infer<
  typeof LocalWorkflowExecutionResultSchema
>;
