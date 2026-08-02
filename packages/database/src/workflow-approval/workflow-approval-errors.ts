export type WorkflowApprovalRepositoryErrorCode =
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_FORBIDDEN'
  | 'APPROVAL_CONFLICT'
  | 'APPROVAL_INVALID'
  | 'APPROVAL_EXPIRED'
  | 'RUN_NOT_FOUND'
  | 'RUNNER_MISMATCH'
  | 'LEASE_INVALID';

export class WorkflowApprovalRepositoryError extends Error {
  constructor(readonly code: WorkflowApprovalRepositoryErrorCode) {
    super(code);
    this.name = 'WorkflowApprovalRepositoryError';
  }
}
