export type SecureRunInputRepositoryErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'RUN_NOT_READY'
  | 'RUNNER_UNAVAILABLE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'KEY_CONFLICT'
  | 'PREPARATION_EXPIRED'
  | 'PREPARATION_CONFLICT'
  | 'ENVELOPE_INVALID'
  | 'SERIALIZATION_FAILURE';

export class SecureRunInputRepositoryError extends Error {
  constructor(
    readonly code: SecureRunInputRepositoryErrorCode,
    readonly detail?: unknown,
  ) {
    super(code);
    this.name = 'SecureRunInputRepositoryError';
  }
}
