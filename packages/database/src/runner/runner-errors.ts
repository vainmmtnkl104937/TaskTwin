export type RunnerRepositoryErrorCode =
  | 'PAIRING_UNAVAILABLE'
  | 'PAIRING_CONFLICT'
  | 'PAIRING_CODE_COLLISION'
  | 'WORKSPACE_NOT_FOUND'
  | 'RUNNER_DEVICE_NOT_FOUND'
  | 'RUNNER_FORBIDDEN'
  | 'RUNNER_REVOKED'
  | 'RUNNER_SOFTWARE_IDENTITY_CONFLICT'
  | 'SERIALIZATION_FAILURE';

export class RunnerRepositoryError extends Error {
  constructor(readonly code: RunnerRepositoryErrorCode) {
    super(code);
    this.name = 'RunnerRepositoryError';
  }
}
