export type WorkflowDraftRepositoryErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKFLOW_VERSION_NOT_FOUND'
  | 'WORKFLOW_DRAFT_FORBIDDEN'
  | 'WORKFLOW_VERSION_NOT_DRAFT'
  | 'WORKFLOW_DEFINITION_INVALID'
  | 'WORKFLOW_ID_IMMUTABLE'
  | 'WORKFLOW_VERSION_IMMUTABLE'
  | 'WORKFLOW_SCHEMA_VERSION_IMMUTABLE'
  | 'WORKFLOW_STATUS_INVALID'
  | 'WORKFLOW_DRAFT_REVISION_CONFLICT'
  | 'PERSISTED_WORKFLOW_INVALID'
  | 'SERIALIZATION_FAILURE';

export class WorkflowDraftRepositoryError extends Error {
  constructor(
    readonly code: WorkflowDraftRepositoryErrorCode,
    readonly currentRevision?: number,
  ) {
    super(code);
    this.name = 'WorkflowDraftRepositoryError';
  }
}
