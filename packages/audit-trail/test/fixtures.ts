import type {
  AuditEventInput,
  AuditEventType,
  AuditPayloadByType,
} from '../src/index.js';

export const WORKSPACE_ID = '00000000-0000-4000-8000-000000000010';
export const USER_ID = '00000000-0000-4000-8000-000000000011';
export const RUNNER_ID = '00000000-0000-4000-8000-000000000012';
export const WORKFLOW_VERSION_ID = '00000000-0000-4000-8000-000000000013';
export const POLICY_VERSION_ID = '00000000-0000-4000-8000-000000000014';
export const RUN_ID = '00000000-0000-4000-8000-000000000015';
export const ATTEMPT_ID = '00000000-0000-4000-8000-000000000016';
export const APPROVAL_ID = '00000000-0000-4000-8000-000000000017';
export const REPAIR_ID = '00000000-0000-4000-8000-000000000018';
export const PROPOSAL_ID = '00000000-0000-4000-8000-000000000019';
export const CANDIDATE_ID = '00000000-0000-4000-8000-000000000020';
export const SCHEDULE_ID = '00000000-0000-4000-8000-000000000030';
export const OCCURRENCE_ID = '00000000-0000-4000-8000-000000000031';
export const ALERT_ID = '00000000-0000-4000-8000-000000000032';
export const DIGEST = 'a'.repeat(64);
export const OCCURRED_AT = '2026-08-05T12:00:00.000Z';

export const VALID_PAYLOADS: AuditPayloadByType = {
  'workflow.created': { workflowId: 'workflow-1' },
  'workflow_version.created': {
    workflowId: 'workflow-1',
    workflowVersionId: WORKFLOW_VERSION_ID,
    version: 2,
    revision: 1,
    sourceVersionId: '00000000-0000-4000-8000-000000000021',
    schemaVersion: 1,
  },
  'workflow_draft.updated': {
    workflowId: 'workflow-1',
    workflowVersionId: WORKFLOW_VERSION_ID,
    version: 2,
    revision: 2,
    stepCount: 4,
  },
  'workflow_version.submitted_for_testing': {
    workflowId: 'workflow-1',
    workflowVersionId: WORKFLOW_VERSION_ID,
    version: 2,
    revision: 2,
  },
  'workflow_version.returned_to_draft': {
    workflowId: 'workflow-1',
    workflowVersionId: WORKFLOW_VERSION_ID,
    version: 2,
    revision: 2,
  },
  'workflow_version.published': {
    workflowId: 'workflow-1',
    workflowVersionId: WORKFLOW_VERSION_ID,
    version: 2,
    revision: 2,
    workflowDigest: DIGEST,
  },
  'workflow_version.archived': {
    workflowId: 'workflow-1',
    workflowVersionId: WORKFLOW_VERSION_ID,
    version: 2,
    revision: 2,
    reason: 'manual',
  },
  'policy_version.archived': {
    policyVersionId: POLICY_VERSION_ID,
    revision: 1,
    policyDigest: DIGEST,
    reason: 'superseded',
  },
  'policy_version.activated': {
    policyVersionId: POLICY_VERSION_ID,
    revision: 2,
    policyDigest: DIGEST,
  },
  'workflow_run.created': {
    workflowRunId: RUN_ID,
    workflowId: 'workflow-1',
    workflowVersionId: WORKFLOW_VERSION_ID,
    runnerDeviceId: RUNNER_ID,
    workflowDigest: DIGEST,
    policyVersionId: POLICY_VERSION_ID,
    policyDigest: DIGEST,
  },
  'workflow_run.claimed': {
    workflowRunId: RUN_ID,
    runnerDeviceId: RUNNER_ID,
    claimAttemptId: '00000000-0000-4000-8000-000000000022',
    leaseExpiresAt: OCCURRED_AT,
  },
  'workflow_run.started': { workflowRunId: RUN_ID, startedAt: OCCURRED_AT },
  'workflow_run.waiting_for_approval': {
    workflowRunId: RUN_ID,
    stepId: 'approval-step',
    stepIndex: 1,
  },
  'workflow_run.waiting_for_repair': {
    workflowRunId: RUN_ID,
    stepId: 'failed-step',
    stepIndex: 2,
    attemptNumber: 1,
  },
  'workflow_run.cancel_requested': {
    workflowRunId: RUN_ID,
    requestedAt: OCCURRED_AT,
  },
  'workflow_run.succeeded': {
    workflowRunId: RUN_ID,
    terminalStatus: 'succeeded',
    finishedAt: OCCURRED_AT,
    engineResultDigest: DIGEST,
    stepCount: 4,
    producedOutputCount: 1,
  },
  'workflow_run.failed': {
    workflowRunId: RUN_ID,
    terminalStatus: 'failed',
    terminationCause: 'STEP_FAILED',
    finishedAt: OCCURRED_AT,
    engineResultDigest: DIGEST,
    stepCount: 4,
    producedOutputCount: 0,
  },
  'workflow_run.cancelled': {
    workflowRunId: RUN_ID,
    terminalStatus: 'cancelled',
    finishedAt: OCCURRED_AT,
    stepCount: 4,
    producedOutputCount: 0,
  },
  'workflow_run.timed_out': {
    workflowRunId: RUN_ID,
    terminalStatus: 'timed_out',
    terminationCause: 'RUN_TIMEOUT',
    finishedAt: OCCURRED_AT,
    stepCount: 4,
    producedOutputCount: 0,
  },
  'workflow_run.interrupted': {
    workflowRunId: RUN_ID,
    terminalStatus: 'interrupted',
    terminationCause: 'LEASE_EXPIRED',
    finishedAt: OCCURRED_AT,
    stepCount: 4,
    producedOutputCount: 0,
  },
  'execution.attempt_started': {
    workflowRunId: RUN_ID,
    runStepAttemptId: ATTEMPT_ID,
    stepId: 'step-1',
    stepIndex: 0,
    stepType: 'click',
    attemptNumber: 1,
    trigger: 'initial',
    effectCertainty: 'not_started',
  },
  'execution.attempt_terminal': {
    workflowRunId: RUN_ID,
    runStepAttemptId: ATTEMPT_ID,
    stepId: 'step-1',
    stepIndex: 0,
    stepType: 'click',
    attemptNumber: 1,
    trigger: 'initial',
    attemptStatus: 'failed',
    effectCertainty: 'unknown',
    safeErrorCode: 'ELEMENT_NOT_FOUND',
    durationMs: 120,
  },
  'execution.verification_completed': {
    workflowRunId: RUN_ID,
    stepId: 'verify-step',
    stepIndex: 3,
    verificationSequence: 1,
    verificationKind: 'equals',
    outcome: 'passed',
    attemptCount: 1,
  },
  'execution.output_produced': {
    workflowRunId: RUN_ID,
    outputName: 'order-id',
    outputType: 'string',
    producerStepId: 'extract-step',
    producerStepIndex: 2,
  },
  'approval.requested': {
    approvalRequestId: APPROVAL_ID,
    workflowRunId: RUN_ID,
    approvalStepId: 'approval-step',
    gatedStepId: 'submit-step',
    riskLevel: 'high',
    requestedAt: OCCURRED_AT,
    expiresAt: '2026-08-05T12:05:00.000Z',
  },
  'approval.decided': {
    approvalRequestId: APPROVAL_ID,
    workflowRunId: RUN_ID,
    decision: 'approved',
    decidedByUserId: USER_ID,
    resolvedAt: OCCURRED_AT,
  },
  'approval.lifecycle': {
    approvalRequestId: APPROVAL_ID,
    workflowRunId: RUN_ID,
    reason: 'expired',
    resolvedAt: OCCURRED_AT,
  },
  'repair.requested': {
    repairRequestId: REPAIR_ID,
    workflowRunId: RUN_ID,
    stepId: 'step-1',
    stepIndex: 0,
    attemptNumber: 1,
    safeErrorCode: 'ELEMENT_NOT_FOUND',
    effectCertainty: 'not_started',
    retryAllowed: true,
    requestedAt: OCCURRED_AT,
    expiresAt: '2026-08-05T12:05:00.000Z',
  },
  'repair.decided': {
    repairRequestId: REPAIR_ID,
    workflowRunId: RUN_ID,
    decision: 'retry_approved',
    decidedByUserId: USER_ID,
    resolvedAt: OCCURRED_AT,
  },
  'repair.lifecycle': {
    repairRequestId: REPAIR_ID,
    workflowRunId: RUN_ID,
    reason: 'invalidated',
    resolvedAt: OCCURRED_AT,
  },
  'locator_repair.proposal_created': {
    proposalId: PROPOSAL_ID,
    workflowRunId: RUN_ID,
    stepId: 'step-1',
    stepIndex: 0,
    failedAttemptNumber: 1,
    candidateCount: 3,
  },
  'locator_repair.candidate_tested': {
    proposalId: PROPOSAL_ID,
    candidateId: CANDIDATE_ID,
    candidateRank: 1,
    candidateStrategy: 'role_name',
    candidateConfidence: 'high',
    testStatus: 'passed',
    evidenceCodeCount: 2,
    testedAt: OCCURRED_AT,
  },
  'locator_repair.applied_to_draft': {
    proposalId: PROPOSAL_ID,
    candidateId: CANDIDATE_ID,
    workflowRunId: RUN_ID,
    stepId: 'step-1',
    stepIndex: 0,
    targetDraftVersionId: WORKFLOW_VERSION_ID,
    previousRevision: 1,
    newRevision: 2,
    appliedAt: OCCURRED_AT,
  },
  'locator_repair.dismissed': {
    proposalId: PROPOSAL_ID,
    workflowRunId: RUN_ID,
    reason: 'expired',
    dismissedAt: OCCURRED_AT,
  },
  'schedule.created': {
    scheduleId: SCHEDULE_ID,
    workflowId: 'workflow-1',
    workflowVersionId: WORKFLOW_VERSION_ID,
    runnerDeviceId: RUNNER_ID,
    scheduleName: 'Daily Cleanup',
    scheduleType: 'daily',
    timezone: 'America/New_York',
    scheduleDigest: DIGEST,
    workflowDigest: DIGEST,
    policyVersionId: POLICY_VERSION_ID,
    policyDigest: DIGEST,
    nextOccurrenceAt: '2026-08-06T08:00:00.000Z',
    maxStartDelaySeconds: 300,
  },
  'schedule.paused': {
    scheduleId: SCHEDULE_ID,
    pausedAt: OCCURRED_AT,
  },
  'schedule.resumed': {
    scheduleId: SCHEDULE_ID,
    resumedAt: OCCURRED_AT,
    nextOccurrenceAt: '2026-08-06T08:00:00.000Z',
  },
  'schedule.completed': {
    scheduleId: SCHEDULE_ID,
    completedAt: OCCURRED_AT,
  },
  'schedule.archived': {
    scheduleId: SCHEDULE_ID,
    archivedAt: OCCURRED_AT,
  },
  'schedule.auto_paused': {
    scheduleId: SCHEDULE_ID,
    reason: 'policy_review_required',
    autoPausedAt: OCCURRED_AT,
  },
  'schedule.occurrence.dispatched': {
    scheduleId: SCHEDULE_ID,
    occurrenceId: OCCURRENCE_ID,
    workflowRunId: RUN_ID,
    scheduledFor: '2026-08-06T08:00:00.000Z',
    startDeadlineAt: '2026-08-06T08:05:00.000Z',
  },
  'schedule.occurrence.skipped': {
    scheduleId: SCHEDULE_ID,
    occurrenceId: OCCURRENCE_ID,
    scheduledFor: '2026-08-06T08:00:00.000Z',
    skipReason: 'runner_busy',
    skippedAt: OCCURRED_AT,
  },
  'schedule.occurrence.start_window_expired': {
    scheduleId: SCHEDULE_ID,
    occurrenceId: OCCURRENCE_ID,
    workflowRunId: RUN_ID,
    scheduledFor: '2026-08-06T08:00:00.000Z',
    startDeadlineAt: '2026-08-06T08:05:00.000Z',
    expiredAt: OCCURRED_AT,
  },
  'schedule.occurrence.succeeded': {
    scheduleId: SCHEDULE_ID,
    occurrenceId: OCCURRENCE_ID,
    workflowRunId: RUN_ID,
  },
  'notification.alert.created': {
    alertId: ALERT_ID, alertType: 'approval_required', severity: 'warning',
    sourceType: 'approval_request', sourceId: APPROVAL_ID, recipientCount: 2,
  },
  'notification.alert.resolved': {
    alertId: ALERT_ID, alertType: 'approval_required', severity: 'warning',
    sourceType: 'approval_request', sourceId: APPROVAL_ID, recipientCount: 2,
  },
  'notification.delivery.dead_lettered': {
    alertId: ALERT_ID, alertType: 'approval_required', severity: 'warning',
    sourceType: 'approval_request', sourceId: APPROVAL_ID, recipientCount: 1,
  },
  'runner.secret_inventory.updated': {
    runnerDeviceId: RUNNER_ID,
    previousRevision: 1,
    newRevision: 2,
    configuredSecretCount: 3,
    inventoryDigest: DIGEST,
  },
};

export function auditInput<EventType extends AuditEventType>(
  eventType: EventType,
  sourceId = `source:${eventType.replaceAll('.', '-')}`,
): AuditEventInput<EventType> {
  return {
    workspaceId: WORKSPACE_ID,
    eventType,
    actor: { type: 'user', userId: USER_ID },
    primaryEntity: { kind: 'workflow_version', id: WORKFLOW_VERSION_ID },
    relatedEntities: [],
    occurredAt: OCCURRED_AT,
    sourceId,
    payload: VALID_PAYLOADS[eventType],
  };
}
