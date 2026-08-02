import {
  MAX_EXECUTION_TIMEOUT_MS,
  MAX_STEP_TIMEOUT_MS,
  MIN_EXECUTION_TIMEOUT_MS,
  MIN_STEP_TIMEOUT_MS,
  WORKFLOW_ENGINE_SCHEMA_VERSION,
} from '@tasktwin/workflow-engine';
import { RecoveryModeSchema } from '@tasktwin/workflow-recovery';
import { z } from 'zod';

export const MIN_BROWSER_TIMEOUT_MS = 100;
export const MAX_ACTION_TIMEOUT_MS = 30_000;
export const MAX_NAVIGATION_TIMEOUT_MS = 60_000;

export const BrowserExecutionOptionsSchema = z.strictObject({
  headless: z.boolean().default(true),
  actionTimeoutMs: z
    .number()
    .int()
    .min(MIN_BROWSER_TIMEOUT_MS)
    .max(MAX_ACTION_TIMEOUT_MS)
    .default(10_000),
  navigationTimeoutMs: z
    .number()
    .int()
    .min(MIN_BROWSER_TIMEOUT_MS)
    .max(MAX_NAVIGATION_TIMEOUT_MS)
    .default(30_000),
});

export const LocalExecutionOptionsSchema = BrowserExecutionOptionsSchema.extend(
  {
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
    recoveryMode: RecoveryModeSchema.default('automatic_safe_only'),
  },
);

export const LocalExecutionRequestSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_ENGINE_SCHEMA_VERSION),
  workflow: z.unknown(),
  inputs: z.unknown(),
  allowedOrigins: z.unknown(),
  options: LocalExecutionOptionsSchema,
});

export type BrowserExecutionOptions = z.infer<
  typeof BrowserExecutionOptionsSchema
>;
export type LocalExecutionOptions = z.infer<typeof LocalExecutionOptionsSchema>;
export type LocalExecutionRequest = z.infer<typeof LocalExecutionRequestSchema>;
