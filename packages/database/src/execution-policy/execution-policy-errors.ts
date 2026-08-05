export type ExecutionPolicyRepositoryErrorCode =
  | 'POLICY_NOT_FOUND'
  | 'POLICY_FORBIDDEN'
  | 'POLICY_MISSING'
  | 'POLICY_INVALID'
  | 'POLICY_REVISION_CONFLICT'
  | 'POLICY_VERSION_CONFLICT'
  | 'POLICY_SERIALIZATION_FAILURE';

export class ExecutionPolicyRepositoryError extends Error {
  constructor(
    readonly code: ExecutionPolicyRepositoryErrorCode,
    readonly currentRevision?: number,
  ) {
    super(code);
    this.name = 'ExecutionPolicyRepositoryError';
  }
}
