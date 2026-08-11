export const RUNNER_ROLLOUT_REPOSITORY_ERROR_CODES = [
  'ROLLOUT_NOT_FOUND',
  'ROLLOUT_FORBIDDEN',
  'ROLLOUT_IDEMPOTENCY_CONFLICT',
  'RELEASE_NOT_AVAILABLE',
  'RUNNER_WORKSPACE_MISMATCH',
  'RUNNER_REVOKED',
  'RUNNER_PLATFORM_INCOMPATIBLE',
  'RUNNER_ACTIVE_ROLLOUT_CONFLICT',
  'STAGE_NOT_FOUND',
  'STAGE_OUT_OF_ORDER',
  'INVALID_STATE_TRANSITION',
  'SERIALIZATION_FAILURE',
] as const;

export type RunnerRolloutRepositoryErrorCode =
  (typeof RUNNER_ROLLOUT_REPOSITORY_ERROR_CODES)[number];

export class RunnerRolloutRepositoryError extends Error {
  constructor(readonly code: RunnerRolloutRepositoryErrorCode) {
    super(code);
    this.name = 'RunnerRolloutRepositoryError';
  }
}
