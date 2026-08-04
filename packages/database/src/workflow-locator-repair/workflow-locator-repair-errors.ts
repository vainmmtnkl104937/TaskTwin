export type WorkflowLocatorRepairRepositoryErrorCode =
  | 'LOCATOR_REPAIR_NOT_FOUND'
  | 'LOCATOR_REPAIR_FORBIDDEN'
  | 'LOCATOR_REPAIR_NOT_ELIGIBLE'
  | 'LOCATOR_REPAIR_INVALID'
  | 'LOCATOR_REPAIR_CONFLICT'
  | 'LOCATOR_REPAIR_EXPIRED'
  | 'LOCATOR_REPAIR_STALE_PAGE_CONTEXT'
  | 'LOCATOR_REPAIR_CANDIDATE_NOT_TESTED'
  | 'LOCATOR_REPAIR_DRAFT_REQUIRED'
  | 'LOCATOR_REPAIR_LINEAGE_MISMATCH'
  | 'LOCATOR_REPAIR_LOCATOR_CHANGED'
  | 'LOCATOR_REPAIR_REVISION_CONFLICT'
  | 'RUNNER_MISMATCH'
  | 'LEASE_INVALID'
  | 'SERIALIZATION_FAILURE';

export class WorkflowLocatorRepairRepositoryError extends Error {
  constructor(
    readonly code: WorkflowLocatorRepairRepositoryErrorCode,
    readonly currentRevision?: number,
  ) {
    super(code);
    this.name = 'WorkflowLocatorRepairRepositoryError';
  }
}
