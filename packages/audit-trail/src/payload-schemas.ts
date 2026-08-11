import { z } from 'zod';

import { normalizeAuditTimestamp } from './canonical-json.js';
import type { AuditEventType } from './event-type.js';

const StableIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const UuidSchema = z.string().uuid();
const CountSchema = z.number().int().min(0).max(1_000_000);
const SequenceSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const DurationSchema = z.number().int().min(0).max(86_400_000);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const SafeCodeSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/);
const BoundedKindSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
const AuditTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .transform(normalizeAuditTimestamp);
const EffectCertaintySchema = z.enum([
  'not_started',
  'read_only',
  'side_effect_possible',
  'completed',
  'unknown',
]);
const AttemptTriggerSchema = z.enum([
  'initial',
  'automatic_retry',
  'manual_retry',
]);
const AttemptTerminalStatusSchema = z.enum([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
]);
const RunTerminalStatusSchema = z.enum([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
]);
const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const WorkflowCreatedPayloadSchema = z
  .object({ workflowId: StableIdSchema })
  .strict();

export const WorkflowVersionCreatedPayloadSchema = z
  .object({
    workflowId: StableIdSchema,
    workflowVersionId: UuidSchema,
    version: SequenceSchema,
    revision: SequenceSchema,
    sourceVersionId: UuidSchema.optional(),
    schemaVersion: SequenceSchema,
  })
  .strict();

export const WorkflowDraftUpdatedPayloadSchema = z
  .object({
    workflowId: StableIdSchema,
    workflowVersionId: UuidSchema,
    version: SequenceSchema,
    revision: SequenceSchema,
    stepCount: CountSchema,
  })
  .strict();

export const WorkflowVersionTransitionPayloadSchema = z
  .object({
    workflowId: StableIdSchema,
    workflowVersionId: UuidSchema,
    version: SequenceSchema,
    revision: SequenceSchema,
  })
  .strict();

export const WorkflowVersionPublishedPayloadSchema = z
  .object({
    workflowId: StableIdSchema,
    workflowVersionId: UuidSchema,
    version: SequenceSchema,
    revision: SequenceSchema,
    workflowDigest: DigestSchema,
    replacedVersionId: UuidSchema.optional(),
  })
  .strict();

export const WorkflowVersionArchivedPayloadSchema = z
  .object({
    workflowId: StableIdSchema,
    workflowVersionId: UuidSchema,
    version: SequenceSchema,
    revision: SequenceSchema,
    reason: z.enum(['manual', 'replaced_by_publish']),
  })
  .strict();

export const PolicyVersionArchivedPayloadSchema = z
  .object({
    policyVersionId: UuidSchema,
    revision: SequenceSchema,
    policyDigest: DigestSchema,
    reason: z.literal('superseded'),
  })
  .strict();

export const PolicyVersionActivatedPayloadSchema = z
  .object({
    policyVersionId: UuidSchema,
    revision: SequenceSchema,
    policyDigest: DigestSchema,
    previousPolicyVersionId: UuidSchema.optional(),
  })
  .strict();

export const WorkflowRunCreatedPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    workflowId: StableIdSchema,
    workflowVersionId: UuidSchema,
    runnerDeviceId: UuidSchema,
    workflowDigest: DigestSchema,
    policyVersionId: UuidSchema,
    policyDigest: DigestSchema,
  })
  .strict();

export const WorkflowRunClaimedPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    runnerDeviceId: UuidSchema,
    claimAttemptId: UuidSchema,
    leaseExpiresAt: AuditTimestampSchema,
  })
  .strict();

export const WorkflowRunStartedPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    startedAt: AuditTimestampSchema,
  })
  .strict();

export const WorkflowRunWaitingPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    stepId: StableIdSchema,
    stepIndex: CountSchema,
    attemptNumber: SequenceSchema.optional(),
  })
  .strict();

export const WorkflowRunCancelRequestedPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    requestedAt: AuditTimestampSchema,
  })
  .strict();

export const WorkflowRunTerminalPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    terminalStatus: RunTerminalStatusSchema,
    terminationCause: SafeCodeSchema.optional(),
    finishedAt: AuditTimestampSchema,
    engineResultDigest: DigestSchema.optional(),
    durationMs: DurationSchema.optional(),
    stepCount: CountSchema,
    producedOutputCount: CountSchema,
  })
  .strict();

export const ExecutionAttemptStartedPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    runStepAttemptId: UuidSchema,
    stepId: StableIdSchema,
    stepIndex: CountSchema,
    stepType: BoundedKindSchema,
    attemptNumber: SequenceSchema,
    trigger: AttemptTriggerSchema,
    effectCertainty: EffectCertaintySchema,
    authorizedByRepairRequestId: UuidSchema.optional(),
  })
  .strict();

export const ExecutionAttemptTerminalPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    runStepAttemptId: UuidSchema,
    stepId: StableIdSchema,
    stepIndex: CountSchema,
    stepType: BoundedKindSchema,
    attemptNumber: SequenceSchema,
    trigger: AttemptTriggerSchema,
    attemptStatus: AttemptTerminalStatusSchema,
    effectCertainty: EffectCertaintySchema,
    safeErrorCode: SafeCodeSchema.optional(),
    durationMs: DurationSchema.optional(),
  })
  .strict();

export const ExecutionVerificationCompletedPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    stepId: StableIdSchema,
    stepIndex: CountSchema,
    verificationSequence: SequenceSchema,
    verificationKind: BoundedKindSchema,
    outcome: z.enum(['passed', 'failed']),
    attemptCount: SequenceSchema,
  })
  .strict();

export const ExecutionOutputProducedPayloadSchema = z
  .object({
    workflowRunId: UuidSchema,
    outputName: StableIdSchema,
    outputType: z.enum(['string', 'boolean']),
    producerStepId: StableIdSchema,
    producerStepIndex: CountSchema,
  })
  .strict();

export const ApprovalRequestedPayloadSchema = z
  .object({
    approvalRequestId: UuidSchema,
    workflowRunId: UuidSchema,
    approvalStepId: StableIdSchema,
    gatedStepId: StableIdSchema,
    riskLevel: RiskLevelSchema,
    requestedAt: AuditTimestampSchema,
    expiresAt: AuditTimestampSchema,
  })
  .strict();

export const ApprovalDecidedPayloadSchema = z
  .object({
    approvalRequestId: UuidSchema,
    workflowRunId: UuidSchema,
    decision: z.enum(['approved', 'rejected']),
    decidedByUserId: UuidSchema,
    resolvedAt: AuditTimestampSchema,
  })
  .strict();

export const ApprovalLifecyclePayloadSchema = z
  .object({
    approvalRequestId: UuidSchema,
    workflowRunId: UuidSchema,
    reason: z.enum(['expired', 'cancelled', 'invalidated']),
    resolvedAt: AuditTimestampSchema,
  })
  .strict();

export const RepairRequestedPayloadSchema = z
  .object({
    repairRequestId: UuidSchema,
    workflowRunId: UuidSchema,
    stepId: StableIdSchema,
    stepIndex: CountSchema,
    attemptNumber: SequenceSchema,
    safeErrorCode: SafeCodeSchema,
    effectCertainty: EffectCertaintySchema,
    retryAllowed: z.boolean(),
    requestedAt: AuditTimestampSchema,
    expiresAt: AuditTimestampSchema,
  })
  .strict();

export const RepairDecidedPayloadSchema = z
  .object({
    repairRequestId: UuidSchema,
    workflowRunId: UuidSchema,
    decision: z.enum(['retry_approved', 'aborted']),
    decidedByUserId: UuidSchema,
    resolvedAt: AuditTimestampSchema,
  })
  .strict();

export const RepairLifecyclePayloadSchema = z
  .object({
    repairRequestId: UuidSchema,
    workflowRunId: UuidSchema,
    reason: z.enum(['expired', 'cancelled', 'invalidated']),
    resolvedAt: AuditTimestampSchema,
  })
  .strict();

export const LocatorRepairProposalCreatedPayloadSchema = z
  .object({
    proposalId: UuidSchema,
    workflowRunId: UuidSchema,
    stepId: StableIdSchema,
    stepIndex: CountSchema,
    failedAttemptNumber: SequenceSchema,
    candidateCount: CountSchema,
  })
  .strict();

export const LocatorRepairCandidateTestedPayloadSchema = z
  .object({
    proposalId: UuidSchema,
    candidateId: UuidSchema,
    candidateRank: SequenceSchema,
    candidateStrategy: BoundedKindSchema,
    candidateConfidence: z.enum(['low', 'medium', 'high']),
    testStatus: z.enum([
      'pending',
      'passed',
      'not_found',
      'not_unique',
      'not_actionable',
      'incompatible_element',
      'stale_page_context',
      'cancelled',
      'error',
    ]),
    evidenceCodeCount: CountSchema,
    testedAt: AuditTimestampSchema.optional(),
  })
  .strict();

export const LocatorRepairAppliedPayloadSchema = z
  .object({
    proposalId: UuidSchema,
    candidateId: UuidSchema,
    workflowRunId: UuidSchema,
    stepId: StableIdSchema,
    stepIndex: CountSchema,
    targetDraftVersionId: UuidSchema,
    previousRevision: SequenceSchema,
    newRevision: SequenceSchema,
    appliedAt: AuditTimestampSchema,
  })
  .strict();

export const LocatorRepairDismissedPayloadSchema = z
  .object({
    proposalId: UuidSchema,
    workflowRunId: UuidSchema,
    reason: z.enum(['expired', 'invalidated']),
    dismissedAt: AuditTimestampSchema,
  })
  .strict();

export const ScheduleCreatedPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    workflowId: StableIdSchema,
    workflowVersionId: UuidSchema,
    runnerDeviceId: UuidSchema,
    scheduleName: z.string().min(1).max(120),
    scheduleType: z.enum(['one_time', 'daily', 'weekly']),
    timezone: z.string().min(1).max(64),
    scheduleDigest: DigestSchema,
    workflowDigest: DigestSchema,
    policyVersionId: UuidSchema,
    policyDigest: DigestSchema,
    nextOccurrenceAt: AuditTimestampSchema.nullable(),
    maxStartDelaySeconds: z.number().int().min(30).max(3600),
  })
  .strict();

export const SchedulePausedPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    pausedAt: AuditTimestampSchema,
  })
  .strict();

export const ScheduleResumedPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    resumedAt: AuditTimestampSchema,
    nextOccurrenceAt: AuditTimestampSchema,
  })
  .strict();

export const ScheduleCompletedPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    completedAt: AuditTimestampSchema,
  })
  .strict();

export const ScheduleArchivedPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    archivedAt: AuditTimestampSchema,
  })
  .strict();

export const ScheduleAutoPausedPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    reason: z.enum([
      'policy_review_required',
      'source_version_unavailable',
      'ambiguous_outcome',
      'secret_readiness_failed',
      'runner_update_required',
    ]),
    autoPausedAt: AuditTimestampSchema,
    triggeringOccurrenceId: UuidSchema.optional(),
  })
  .strict();

export const ScheduleOccurrenceDispatchedPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    occurrenceId: UuidSchema,
    workflowRunId: UuidSchema,
    scheduledFor: AuditTimestampSchema,
    startDeadlineAt: AuditTimestampSchema,
  })
  .strict();

export const ScheduleOccurrenceSkippedPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    occurrenceId: UuidSchema,
    scheduledFor: AuditTimestampSchema,
    skipReason: z.enum([
      'schedule_overlap',
      'runner_busy',
      'runner_unavailable',
      'runner_update_required',
      'runner_maintenance',
      'policy_denied',
      'source_version_unavailable',
      'missed_start_window',
      'nonexistent_local_time',
      'repeated_local_time',
      'secret_readiness_failed',
      'secret_inventory_changed_before_execution',
    ]),
    skippedAt: AuditTimestampSchema,
  })
  .strict();

export const ScheduleOccurrenceStartWindowExpiredPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    occurrenceId: UuidSchema,
    workflowRunId: UuidSchema,
    scheduledFor: AuditTimestampSchema,
    startDeadlineAt: AuditTimestampSchema,
    expiredAt: AuditTimestampSchema,
  })
  .strict();

export const ScheduleOccurrenceSucceededPayloadSchema = z
  .object({
    scheduleId: UuidSchema,
    occurrenceId: UuidSchema,
    workflowRunId: UuidSchema,
  })
  .strict();

const AlertTypeSchema = z.enum([
  'approval_required',
  'repair_required',
  'run_failed',
  'run_timed_out',
  'run_interrupted',
  'schedule_auto_paused',
  'audit_integrity_failed',
  'runner_rollout_requires_review',
]);
const AlertSeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);
const AlertSourceTypeSchema = z.enum([
  'approval_request',
  'repair_request',
  'workflow_run',
  'workflow_schedule',
  'workflow_schedule_occurrence',
  'audit_verification_failure',
  'runner_release_rollout',
  'runner_release_rollout_assignment',
]);

export const NotificationAlertCreatedPayloadSchema = z
  .object({
    alertId: UuidSchema,
    alertType: AlertTypeSchema,
    severity: AlertSeveritySchema,
    sourceType: AlertSourceTypeSchema,
    sourceId: StableIdSchema,
    recipientCount: CountSchema,
  })
  .strict();

export const NotificationAlertResolvedPayloadSchema = z
  .object({
    alertId: UuidSchema,
    alertType: AlertTypeSchema,
    severity: AlertSeveritySchema,
    sourceType: AlertSourceTypeSchema,
    sourceId: StableIdSchema,
    recipientCount: CountSchema,
  })
  .strict();

export const NotificationDeliveryDeadLetteredPayloadSchema = z
  .object({
    alertId: UuidSchema,
    alertType: AlertTypeSchema,
    severity: AlertSeveritySchema,
    sourceType: AlertSourceTypeSchema,
    sourceId: StableIdSchema,
    recipientCount: CountSchema,
  })
  .strict();

export const RunnerSecretInventoryUpdatedPayloadSchema = z
  .object({
    runnerDeviceId: UuidSchema,
    previousRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    newRevision: SequenceSchema,
    configuredSecretCount: CountSchema,
    inventoryDigest: DigestSchema,
  })
  .strict();

export const RunnerSoftwareVersionChangedPayloadSchema = z
  .object({
    runnerDeviceId: UuidSchema,
    previousVersion: z.string().trim().min(1).max(32),
    newVersion: z.string().trim().min(1).max(32),
    runnerProtocolVersion: z.number().int().positive().nullable(),
    localStateSchemaVersion: z.number().int().positive().nullable(),
  })
  .strict();

const RunnerRuntimeModeValueSchema = z.enum([
  'interactive',
  'unattended_process',
  'service',
]);
const RunnerAutonomyValueSchema = z.enum([
  'interactive',
  'process_unattended',
  'boot_resilient',
]);
const RunnerServiceStatusValueSchema = z.enum([
  'not_applicable',
  'starting',
  'running',
  'degraded',
  'draining',
  'stopped',
]);
const RunnerSecretUnlockModeValueSchema = z.enum([
  'none',
  'manual',
  'os_native',
]);

export const RunnerRuntimeModeChangedPayloadSchema = z
  .object({
    runnerDeviceId: UuidSchema,
    previousRuntimeMode: RunnerRuntimeModeValueSchema.nullable(),
    runtimeMode: RunnerRuntimeModeValueSchema,
    previousAutonomyLevel: RunnerAutonomyValueSchema.nullable(),
    autonomyLevel: RunnerAutonomyValueSchema,
    serviceStatus: RunnerServiceStatusValueSchema,
  })
  .strict();

export const RunnerSecretProtectorChangedPayloadSchema = z
  .object({
    runnerDeviceId: UuidSchema,
    previousUnlockMode: RunnerSecretUnlockModeValueSchema.nullable(),
    unlockMode: RunnerSecretUnlockModeValueSchema,
  })
  .strict();

const RolloutStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled',
]);

export const RunnerRolloutCreatedPayloadSchema = z
  .object({
    rolloutId: UuidSchema,
    targetReleaseId: UuidSchema,
    stageCount: CountSchema,
    assignmentCount: CountSchema,
  })
  .strict();

export const RunnerRolloutStatusPayloadSchema = z
  .object({
    rolloutId: UuidSchema,
    status: RolloutStatusSchema,
    reason: z
      .enum(['manual', 'target_release_blocked', 'assignment_rolled_back'])
      .optional(),
    changedAt: AuditTimestampSchema,
  })
  .strict();

export const RunnerRolloutStageActivatedPayloadSchema = z
  .object({
    rolloutId: UuidSchema,
    stageId: UuidSchema,
    stageNumber: SequenceSchema,
    targetReleaseId: UuidSchema,
    assignmentCount: CountSchema,
  })
  .strict();

export const RunnerRolloutAssignmentObservedPayloadSchema = z
  .object({
    rolloutId: UuidSchema,
    stageId: UuidSchema,
    assignmentId: UuidSchema,
    runnerDeviceId: UuidSchema,
    stageNumber: SequenceSchema,
    observedAt: AuditTimestampSchema,
  })
  .strict();

export const AUDIT_PAYLOAD_SCHEMAS = {
  'workflow.created': WorkflowCreatedPayloadSchema,
  'workflow_version.created': WorkflowVersionCreatedPayloadSchema,
  'workflow_draft.updated': WorkflowDraftUpdatedPayloadSchema,
  'workflow_version.submitted_for_testing':
    WorkflowVersionTransitionPayloadSchema,
  'workflow_version.returned_to_draft': WorkflowVersionTransitionPayloadSchema,
  'workflow_version.published': WorkflowVersionPublishedPayloadSchema,
  'workflow_version.archived': WorkflowVersionArchivedPayloadSchema,
  'policy_version.archived': PolicyVersionArchivedPayloadSchema,
  'policy_version.activated': PolicyVersionActivatedPayloadSchema,
  'workflow_run.created': WorkflowRunCreatedPayloadSchema,
  'workflow_run.claimed': WorkflowRunClaimedPayloadSchema,
  'workflow_run.started': WorkflowRunStartedPayloadSchema,
  'workflow_run.waiting_for_approval': WorkflowRunWaitingPayloadSchema,
  'workflow_run.waiting_for_repair': WorkflowRunWaitingPayloadSchema,
  'workflow_run.cancel_requested': WorkflowRunCancelRequestedPayloadSchema,
  'workflow_run.succeeded': WorkflowRunTerminalPayloadSchema,
  'workflow_run.failed': WorkflowRunTerminalPayloadSchema,
  'workflow_run.cancelled': WorkflowRunTerminalPayloadSchema,
  'workflow_run.timed_out': WorkflowRunTerminalPayloadSchema,
  'workflow_run.interrupted': WorkflowRunTerminalPayloadSchema,
  'execution.attempt_started': ExecutionAttemptStartedPayloadSchema,
  'execution.attempt_terminal': ExecutionAttemptTerminalPayloadSchema,
  'execution.verification_completed':
    ExecutionVerificationCompletedPayloadSchema,
  'execution.output_produced': ExecutionOutputProducedPayloadSchema,
  'approval.requested': ApprovalRequestedPayloadSchema,
  'approval.decided': ApprovalDecidedPayloadSchema,
  'approval.lifecycle': ApprovalLifecyclePayloadSchema,
  'repair.requested': RepairRequestedPayloadSchema,
  'repair.decided': RepairDecidedPayloadSchema,
  'repair.lifecycle': RepairLifecyclePayloadSchema,
  'locator_repair.proposal_created': LocatorRepairProposalCreatedPayloadSchema,
  'locator_repair.candidate_tested': LocatorRepairCandidateTestedPayloadSchema,
  'locator_repair.applied_to_draft': LocatorRepairAppliedPayloadSchema,
  'locator_repair.dismissed': LocatorRepairDismissedPayloadSchema,
  'schedule.created': ScheduleCreatedPayloadSchema,
  'schedule.paused': SchedulePausedPayloadSchema,
  'schedule.resumed': ScheduleResumedPayloadSchema,
  'schedule.completed': ScheduleCompletedPayloadSchema,
  'schedule.archived': ScheduleArchivedPayloadSchema,
  'schedule.auto_paused': ScheduleAutoPausedPayloadSchema,
  'schedule.occurrence.dispatched': ScheduleOccurrenceDispatchedPayloadSchema,
  'schedule.occurrence.skipped': ScheduleOccurrenceSkippedPayloadSchema,
  'schedule.occurrence.start_window_expired':
    ScheduleOccurrenceStartWindowExpiredPayloadSchema,
  'schedule.occurrence.succeeded': ScheduleOccurrenceSucceededPayloadSchema,
  'notification.alert.created': NotificationAlertCreatedPayloadSchema,
  'notification.alert.resolved': NotificationAlertResolvedPayloadSchema,
  'notification.delivery.dead_lettered':
    NotificationDeliveryDeadLetteredPayloadSchema,
  'runner.secret_inventory.updated': RunnerSecretInventoryUpdatedPayloadSchema,
  'runner.software_version.changed': RunnerSoftwareVersionChangedPayloadSchema,
  'runner.runtime_mode.changed': RunnerRuntimeModeChangedPayloadSchema,
  'runner.secret_protector.changed': RunnerSecretProtectorChangedPayloadSchema,
  'runner.rollout.created': RunnerRolloutCreatedPayloadSchema,
  'runner.rollout.activated': RunnerRolloutStatusPayloadSchema,
  'runner.rollout.paused': RunnerRolloutStatusPayloadSchema,
  'runner.rollout.cancelled': RunnerRolloutStatusPayloadSchema,
  'runner.rollout.stage.activated': RunnerRolloutStageActivatedPayloadSchema,
  'runner.rollout.assignment.converged':
    RunnerRolloutAssignmentObservedPayloadSchema,
  'runner.rollout.assignment.rolled_back':
    RunnerRolloutAssignmentObservedPayloadSchema,
} as const satisfies Record<AuditEventType, z.ZodType>;

export function parseAuditPayload<EventType extends AuditEventType>(
  eventType: EventType,
  payload: unknown,
): z.infer<(typeof AUDIT_PAYLOAD_SCHEMAS)[EventType]> {
  return AUDIT_PAYLOAD_SCHEMAS[eventType].parse(payload) as z.infer<
    (typeof AUDIT_PAYLOAD_SCHEMAS)[EventType]
  >;
}
