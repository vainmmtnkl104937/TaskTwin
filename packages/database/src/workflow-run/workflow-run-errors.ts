export type WorkflowRunRepositoryErrorCode =
  | 'RUN_NOT_FOUND'
  | 'RUN_FORBIDDEN'
  | 'RUN_NOT_READY'
  | 'RUN_CONFLICT'
  | 'RUNNER_MISMATCH'
  | 'RUNNER_REVOKED'
  | 'LEASE_INVALID'
  | 'LEASE_EXPIRED'
  | 'PROGRESS_SEQUENCE_INVALID'
  | 'PROGRESS_TRANSITION_INVALID'
  | 'PROGRESS_BATCH_CONFLICT'
  | 'COMPLETION_INVALID'
  | 'COMPLETION_CONFLICT'
  | 'SERIALIZATION_FAILURE';

export class WorkflowRunRepositoryError extends Error {
  constructor(
    readonly code: WorkflowRunRepositoryErrorCode,
    readonly readiness?: unknown,
  ) {
    super(code);
    this.name = 'WorkflowRunRepositoryError';
  }
}
