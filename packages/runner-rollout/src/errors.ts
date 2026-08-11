export const RUNNER_ROLLOUT_ERROR_CODES = [
  'release_not_available',
  'release_version_conflict',
  'runner_duplicate_assignment',
  'runner_workspace_mismatch',
  'runner_revoked',
  'runner_platform_incompatible',
  'runner_active_rollout_conflict',
  'stage_out_of_order',
  'stage_not_converged',
  'invalid_state_transition',
  'rollout_requires_review',
] as const;

export type RunnerRolloutErrorCode =
  (typeof RUNNER_ROLLOUT_ERROR_CODES)[number];

export class RunnerRolloutError extends Error {
  readonly code: RunnerRolloutErrorCode;

  constructor(code: RunnerRolloutErrorCode, message: string) {
    super(message);
    this.name = 'RunnerRolloutError';
    this.code = code;
  }
}
