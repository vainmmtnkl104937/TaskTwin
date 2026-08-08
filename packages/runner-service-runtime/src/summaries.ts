import {
  RUNNER_SERVICE_RUNTIME_SCHEMA_VERSION,
  RunnerServiceSummarySchema,
  type RunnerServiceSummary,
} from './contracts.js';

export function buildRunnerServiceSummary(
  input: Omit<RunnerServiceSummary, 'schemaVersion'>,
): RunnerServiceSummary {
  return RunnerServiceSummarySchema.parse({
    schemaVersion: RUNNER_SERVICE_RUNTIME_SCHEMA_VERSION,
    ...input,
  });
}
