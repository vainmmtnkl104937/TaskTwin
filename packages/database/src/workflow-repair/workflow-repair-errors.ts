export type WorkflowRepairRepositoryErrorCode =
  | 'REPAIR_NOT_FOUND'
  | 'REPAIR_FORBIDDEN'
  | 'REPAIR_CONFLICT'
  | 'REPAIR_INVALID'
  | 'REPAIR_EXPIRED'
  | 'RUN_NOT_FOUND'
  | 'RUNNER_MISMATCH'
  | 'LEASE_INVALID';

export class WorkflowRepairRepositoryError extends Error {
  constructor(readonly code: WorkflowRepairRepositoryErrorCode) {
    super(code);
    this.name = 'WorkflowRepairRepositoryError';
  }
}
