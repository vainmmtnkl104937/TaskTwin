export { createDatabaseClient } from './database-client.js';
export {
  getRequiredDatabaseUrl,
  getRequiredEnvironmentSecret,
} from './database-url.js';
export {
  OrganizationRole,
  Prisma,
  PrismaClient,
  RecordingSessionStatus,
  RunnerPairingStatus,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  WorkflowApprovalRequestStatus,
  WorkflowApprovalRiskLevel,
} from './generated/prisma/client.js';
export { DuplicateEmailError } from './identity/identity-errors.js';
export { IdentityRepository } from './identity/identity.repository.js';
export type {
  AuthenticationUserRecord,
  CreateRegistrationInput,
  CreateRegistrationResult,
  OrganizationMembershipRecord,
  OrganizationRecord,
  SafeUserRecord,
  WorkspaceRecord,
  WorkspaceAccessRecord,
} from './identity/identity-records.js';
export { normalizeEmail } from './identity/normalize-email.js';
export { createCanonicalJsonDigest } from './recording/canonical-json.js';
export {
  RecordingWorkflowConversionRepositoryError,
  type RecordingWorkflowConversionRepositoryErrorCode,
} from './recording-conversion/recording-workflow-conversion-errors.js';
export type {
  CreateRecordingWorkflowConversionResult,
  RecordingWorkflowConversionRecord,
} from './recording-conversion/recording-workflow-conversion-records.js';
export { RecordingWorkflowConversionRepository } from './recording-conversion/recording-workflow-conversion.repository.js';
export {
  RecordingRepositoryError,
  type RecordingRepositoryErrorCode,
} from './recording/recording-errors.js';
export type {
  CompleteRecordingSessionResult,
  CompletedRecordingArtifactRecord,
  CreateRecordingSessionResult,
  IngestRecordingBatchResult,
  OrganizationAccessRecord,
  RecordingSessionMetadataRecord,
} from './recording/recording-records.js';
export { RecordingRepository } from './recording/recording.repository.js';
export {
  RunnerRepositoryError,
  type RunnerRepositoryErrorCode,
} from './runner/runner-errors.js';
export type {
  RunnerAuthenticationRecord,
  RunnerDeviceListRecord,
  RunnerDeviceRecord,
  RunnerHeartbeatPersistenceResult,
  RunnerOrganizationAccess,
  RunnerPairingRecord,
  RunnerPollingResult,
} from './runner/runner-records.js';
export { RunnerRepository } from './runner/runner.repository.js';
export { RunnerReleaseRepository } from './runner-release/runner-release.repository.js';
export {
  RunnerReleaseRepositoryError,
  RUNNER_RELEASE_REPOSITORY_ERROR_CODES,
} from './runner-release/runner-release-errors.js';
export type {
  RunnerReleaseRecord,
  TrustedRunnerReleaseImport,
} from './runner-release/runner-release-records.js';
export { RunnerRolloutRepository } from './runner-rollout/runner-rollout.repository.js';
export {
  RunnerRolloutRepositoryError,
  RUNNER_ROLLOUT_REPOSITORY_ERROR_CODES,
} from './runner-rollout/runner-rollout-errors.js';
export type {
  RunnerRolloutAccess,
  RunnerRolloutRecord,
  RunnerRolloutStageRecord,
  RunnerRolloutAssignmentRecord,
} from './runner-rollout/runner-rollout-records.js';
export {
  CONTROL_PLANE_RUNNER_COMPATIBILITY_POLICY,
  canRunnerClaimJobs,
  evaluatePersistedRunnerCompatibility,
  toPersistedRunnerSoftwareIdentity,
  type PersistedRunnerSoftwareFields,
} from './runner/runner-software-compatibility.js';
export {
  WorkflowVersionRepository,
  type PersistedWorkflowVersion,
} from './workflow-version.repository.js';
export {
  WorkflowDraftRepositoryError,
  type WorkflowDraftRepositoryErrorCode,
} from './workflow-draft/workflow-draft-errors.js';
export type {
  UpdateWorkflowDraftResult,
  WorkflowAccessRecord,
  WorkflowListItemRecord,
  WorkflowVersionDetailRecord,
  WorkspaceWorkflowListRecord,
} from './workflow-draft/workflow-draft-records.js';
export { WorkflowDraftRepository } from './workflow-draft/workflow-draft.repository.js';
export {
  WorkflowLifecycleRepositoryError,
  type WorkflowLifecycleRepositoryErrorCode,
} from './workflow-lifecycle/workflow-lifecycle-errors.js';
export type {
  CreateWorkflowVersionResult,
  WorkflowLifecycleActionResult,
  WorkflowVersionHistoryItemRecord,
  WorkflowVersionHistoryRecord,
} from './workflow-lifecycle/workflow-lifecycle-records.js';
export { WorkflowLifecycleRepository } from './workflow-lifecycle/workflow-lifecycle.repository.js';
export {
  WorkflowRunRepositoryError,
  type WorkflowRunRepositoryErrorCode,
} from './workflow-run/workflow-run-errors.js';
export type {
  ClaimWorkflowRunResult,
  CompletionInput,
  CompletionResult,
  CreateWorkflowRunResult,
  ProgressBatchResult,
  WorkflowRunAccess,
  WorkflowRunListRecord,
  WorkflowRunRecord,
  WorkflowRunStepRecord,
} from './workflow-run/workflow-run-records.js';
export { WorkflowRunRepository } from './workflow-run/workflow-run.repository.js';
export {
  WorkflowApprovalRepositoryError,
  type WorkflowApprovalRepositoryErrorCode,
} from './workflow-approval/workflow-approval-errors.js';
export type {
  WorkflowApprovalAccess,
  WorkflowApprovalDecisionResult,
  WorkflowApprovalRecord,
} from './workflow-approval/workflow-approval-records.js';
export { WorkflowApprovalRepository } from './workflow-approval/workflow-approval.repository.js';
export {
  WorkflowRepairRepositoryError,
  type WorkflowRepairRepositoryErrorCode,
} from './workflow-repair/workflow-repair-errors.js';
export type {
  WorkflowRepairAccess,
  WorkflowRepairDecisionResult,
  WorkflowRepairRecord,
} from './workflow-repair/workflow-repair-records.js';
export { WorkflowRepairRepository } from './workflow-repair/workflow-repair.repository.js';
export {
  WorkflowLocatorRepairRepositoryError,
  type WorkflowLocatorRepairRepositoryErrorCode,
} from './workflow-locator-repair/workflow-locator-repair-errors.js';
export type {
  WorkflowLocatorRepairAccess,
  WorkflowLocatorRepairCandidateRecord,
  WorkflowLocatorRepairProposalRecord,
} from './workflow-locator-repair/workflow-locator-repair-records.js';
export { WorkflowLocatorRepairRepository } from './workflow-locator-repair/workflow-locator-repair.repository.js';
export {
  SecureRunInputRepositoryError,
  type SecureRunInputRepositoryErrorCode,
} from './secure-run-input/secure-run-input-errors.js';
export type {
  RunInputCommitResult,
  RunInputPreparationResult,
  RunnerEncryptionKeyRegistrationResult,
} from './secure-run-input/secure-run-input-records.js';
export { SecureRunInputRepository } from './secure-run-input/secure-run-input.repository.js';
export {
  WorkflowScheduleRepositoryError,
  type WorkflowScheduleRepositoryErrorCode,
} from './workflow-schedule/workflow-schedule-errors.js';
export type {
  ScheduleCreationResult,
  WorkflowScheduleAccess,
  WorkflowScheduleOccurrenceRecord,
  WorkflowScheduleRecord,
} from './workflow-schedule/workflow-schedule-records.js';
export { WorkflowScheduleRepository } from './workflow-schedule/workflow-schedule.repository.js';
export {
  ExecutionPolicyRepositoryError,
  type ExecutionPolicyRepositoryErrorCode,
} from './execution-policy/execution-policy-errors.js';
export type {
  ExecutionPolicyVersionListRecord,
  ExecutionPolicyVersionRecord,
  WorkspaceExecutionPolicyRecord,
} from './execution-policy/execution-policy-records.js';
export { ExecutionPolicyRepository } from './execution-policy/execution-policy.repository.js';
export { WorkspaceAuditTrailRepository } from './audit-trail/audit-trail.repository.js';
export {
  appendAuditEventTransactional,
  createAuditAppenderDriver,
  PrismaAuditAppenderDriver,
  auditHasherForTrail,
  type CreateAuditAppenderDriverOptions,
} from './audit-trail/audit-appender.repository.js';
export type {
  AuditEventRecord,
  ListAuditEventsFilters,
  ListAuditEventsResult,
  WorkspaceAuditChainHeadRecord,
  AuditChainHeadSnapshot,
  VerifyAuditTrailRange,
} from './audit-trail/audit-trail-records.js';
export {
  AuditTrailRepositoryError,
  AUDIT_TRAIL_ERROR_CODES,
} from './audit-trail/audit-trail-errors.js';
export type { AuditTrailErrorCode } from './audit-trail/audit-trail-errors.js';
export type {
  DatabaseTransactionClient,
  OperationalAlertResolutionReason,
  OperationalAlertTransactionAppender,
  ResolveOperationalAlertInput,
} from './operational-alerts/operational-alert-port.js';
export { ComponentHeartbeatRepository } from './operational-telemetry/component-heartbeat.repository.js';
export {
  AuditVerificationStateRepository,
  type AuditVerificationStateRecord,
} from './operational-telemetry/audit-verification-state.repository.js';
export { RunnerSecretInventoryRepository } from './runner-secret-inventory/runner-secret-inventory.repository.js';
export { RunnerSecretInventoryRepositoryError } from './runner-secret-inventory/runner-secret-inventory-errors.js';
export type { RunnerSecretInventoryRepositoryErrorCode } from './runner-secret-inventory/runner-secret-inventory-errors.js';
export type {
  RunnerSecretInventoryRecord,
  RunnerSecretInventorySyncResult,
} from './runner-secret-inventory/runner-secret-inventory-records.js';
