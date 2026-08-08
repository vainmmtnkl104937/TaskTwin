import { z } from 'zod';

export const RUNNER_SERVICE_RUNTIME_SCHEMA_VERSION = 1 as const;

export const RunnerRuntimeModeSchema = z.enum([
  'interactive',
  'unattended_process',
  'service',
]);

export const RunnerAutonomyLevelSchema = z.enum([
  'interactive',
  'process_unattended',
  'boot_resilient',
]);

export const RunnerServiceStatusSchema = z.enum([
  'not_applicable',
  'starting',
  'running',
  'degraded',
  'draining',
  'stopped',
]);

export const RunnerSecretUnlockModeSchema = z.enum([
  'none',
  'manual',
  'os_native',
]);

export const RunnerServiceLifecycleStateSchema = z.enum([
  'created',
  'initializing',
  'connecting',
  'ready',
  'draining',
  'stopping',
  'stopped',
  'failed',
  'revoked',
]);

export const RunnerRuntimeReportSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SERVICE_RUNTIME_SCHEMA_VERSION),
  runtimeMode: RunnerRuntimeModeSchema,
  autonomyLevel: RunnerAutonomyLevelSchema,
  serviceStatus: RunnerServiceStatusSchema,
  secretUnlockMode: RunnerSecretUnlockModeSchema,
  restartResilient: z.boolean(),
});

export const RunnerRuntimeMetadataSchema = RunnerRuntimeReportSchema.extend({
  runtimeMetadataRevision: z.number().int().nonnegative().max(2_147_483_647),
});

export const RunnerServiceSummarySchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SERVICE_RUNTIME_SCHEMA_VERSION),
  lifecycle: RunnerServiceLifecycleStateSchema,
  runtimeMode: RunnerRuntimeModeSchema,
  autonomyLevel: RunnerAutonomyLevelSchema,
  serviceStatus: RunnerServiceStatusSchema,
  secretUnlockMode: RunnerSecretUnlockModeSchema,
  restartResilient: z.boolean(),
  acceptsNewJobs: z.boolean(),
});

export type RunnerRuntimeMode = z.infer<typeof RunnerRuntimeModeSchema>;
export type RunnerAutonomyLevel = z.infer<typeof RunnerAutonomyLevelSchema>;
export type RunnerServiceStatus = z.infer<typeof RunnerServiceStatusSchema>;
export type RunnerSecretUnlockMode = z.infer<typeof RunnerSecretUnlockModeSchema>;
export type RunnerServiceLifecycleState = z.infer<typeof RunnerServiceLifecycleStateSchema>;
export type RunnerRuntimeMetadata = z.infer<typeof RunnerRuntimeMetadataSchema>;
export type RunnerRuntimeReport = z.infer<typeof RunnerRuntimeReportSchema>;
export type RunnerServiceSummary = z.infer<typeof RunnerServiceSummarySchema>;
