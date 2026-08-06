export type WorkflowScheduleRepositoryErrorCode =
  | 'SCHEDULE_NOT_FOUND'
  | 'SCHEDULE_FORBIDDEN'
  | 'SCHEDULE_IDEMPOTENCY_CONFLICT'
  | 'SCHEDULE_VERSION_UNAVAILABLE'
  | 'SCHEDULE_RUNNER_MISMATCH'
  | 'SCHEDULE_RUNNER_REVOKED'
  | 'SCHEDULE_POLICY_DENIED'
  | 'SCHEDULE_NOT_READY'
  | 'SCHEDULE_COMPLETED'
  | 'SCHEDULE_ARCHIVED'
  | 'SCHEDULE_NOT_PAUSED'
  | 'SCHEDULE_CANNOT_RESUME'
  | 'SCHEDULE_UNATTENDED_NOT_SUPPORTED'
  | 'OCCURRENCE_DUPLICATE'
  | 'OCCURRENCE_NOT_FOUND'
  | 'OCCURRENCE_INVALID'
  | 'RUNNER_NOT_CAPABLE'
  | 'RUNNER_BUSY'
  | 'SCHEDULER_CONFLICT'
  | 'SERIALIZATION_FAILURE';

export class WorkflowScheduleRepositoryError extends Error {
  constructor(
    readonly code: WorkflowScheduleRepositoryErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'WorkflowScheduleRepositoryError';
  }
}
