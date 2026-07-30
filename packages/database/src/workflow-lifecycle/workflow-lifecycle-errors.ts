import type { PublishReadinessReport } from '@tasktwin/workflow-lifecycle';

export type WorkflowLifecycleRepositoryErrorCode =
  | 'INVALID_LIFECYCLE_INPUT'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_VERSION_NOT_FOUND'
  | 'WORKFLOW_LIFECYCLE_FORBIDDEN'
  | 'INVALID_LIFECYCLE_TRANSITION'
  | 'WORKFLOW_PUBLISH_READINESS_BLOCKED'
  | 'WORKFLOW_VERSION_REVISION_CONFLICT'
  | 'WORKFLOW_VERSION_CREATION_CONFLICT'
  | 'SOURCE_VERSION_NOT_CLONEABLE'
  | 'PERSISTED_WORKFLOW_INVALID'
  | 'SERIALIZATION_FAILURE';

export class WorkflowLifecycleRepositoryError extends Error {
  constructor(
    readonly code: WorkflowLifecycleRepositoryErrorCode,
    readonly context: {
      currentRevision?: number;
      readiness?: PublishReadinessReport;
    } = {},
  ) {
    super(code);
    this.name = 'WorkflowLifecycleRepositoryError';
  }
}
