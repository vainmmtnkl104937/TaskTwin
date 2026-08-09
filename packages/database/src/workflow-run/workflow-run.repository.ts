import {
  validRunTransitions,
  validStepTransitions,
  WorkflowExecutionResultSchema,
  type WorkflowEngineRunStatus,
  type WorkflowEngineStepStatus,
} from '@tasktwin/workflow-engine';
import {
  RUN_PROTOCOL_VERSION,
  analyzeWorkflowRunReadiness,
  canTransitionRunStep,
  type PersistedRunStepStatus,
  type WorkflowProgressBatch,
  type WorkflowRunStatus as ProtocolRunStatus,
} from '@tasktwin/run-protocol';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import {
  WorkspaceExecutionPolicyDefinitionSchema,
  WorkflowPolicyEvaluationSchema,
  evaluateWorkflowPolicy,
} from '@tasktwin/workflow-policy';
import {
  WORKFLOW_EXTRACTION_CAPABILITY,
  WORKFLOW_APPROVAL_CAPABILITY,
  WORKFLOW_VERIFICATION_CAPABILITY,
  WORKFLOW_MANUAL_REPAIR_CAPABILITY,
} from '@tasktwin/runner-protocol';
import { SafeStepAttemptListSchema } from '@tasktwin/workflow-recovery';
import { defineWorkflowOutputs } from '@tasktwin/workflow-extraction';
import {
  RunInputAdditionalAuthenticatedDataSchema,
  SecureRunInputEnvelopeSchema,
  SecureRunInputManifestSchema,
} from '@tasktwin/secure-run-inputs';
import { analyzeWorkflowInputs } from '@tasktwin/workflow-inputs';
import type { LocalSecretInventoryPin } from '@tasktwin/local-secret-store';
import {
  createAuditSourceId,
  type AuditEventInput,
} from '@tasktwin/audit-trail';

import {
  OrganizationRole,
  Prisma,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  WorkflowRunOutputStatus,
  WorkflowRunOutputType,
  WorkflowApprovalRequestStatus,
  WorkflowRepairRequestStatus,
  WorkflowExecutionEffectCertainty,
  WorkflowRunStepAttemptStatus,
  WorkflowRunStepAttemptTrigger,
  type PrismaClient,
} from '../generated/prisma/client.js';
import {
  appendAuditEventTransactional,
  auditHasherForTrail,
} from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { WorkflowRunRepositoryError } from './workflow-run-errors.js';
import type {
  ClaimWorkflowRunResult,
  CompletionInput,
  CompletionResult,
  CreateWorkflowRunResult,
  ProgressBatchResult,
  WorkflowRunAccess,
  WorkflowRunListRecord,
  WorkflowRunRecord,
} from './workflow-run-records.js';
import type { OperationalAlertTransactionAppender } from '../operational-alerts/operational-alert-port.js';
import {
  canRunnerClaimJobs,
  evaluatePersistedRunnerCompatibility,
} from '../runner/runner-software-compatibility.js';

const ACTIVE_STATUSES = [
  WorkflowRunStatus.CLAIMED,
  WorkflowRunStatus.RUNNING,
  WorkflowRunStatus.WAITING_FOR_APPROVAL,
  WorkflowRunStatus.WAITING_FOR_REPAIR,
  WorkflowRunStatus.CANCEL_REQUESTED,
] as const;
const TERMINAL_STATUSES = [
  WorkflowRunStatus.SUCCEEDED,
  WorkflowRunStatus.FAILED,
  WorkflowRunStatus.CANCELLED,
  WorkflowRunStatus.TIMED_OUT,
  WorkflowRunStatus.INTERRUPTED,
] as const;
const WRITER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;
const SERIALIZATION_RETRY_COUNT = 3;

const RUN_EVENT_NAMESPACES = {
  created: 'workflow_run_created',
  claimed: 'workflow_run_claimed',
  started: 'workflow_run_started',
  waitingForApproval: 'workflow_run_waiting_for_approval',
  waitingForRepair: 'workflow_run_waiting_for_repair',
  cancelRequested: 'workflow_run_cancel_requested',
  terminal: 'workflow_run_terminal',
  interrupted: 'workflow_run_interrupted',
  attemptStarted: 'execution_attempt_started',
  attemptTerminal: 'execution_attempt_terminal',
  verificationCompleted: 'execution_verification_completed',
  outputProduced: 'execution_output_produced',
} as const;

const APPROVAL_LIFECYCLE_NAMESPACE = 'approval_lifecycle';
const REPAIR_LIFECYCLE_NAMESPACE = 'repair_lifecycle';

function buildApprovalLifecycleInput(input: {
  workspaceId: string;
  actor: { type: 'system'; reason: 'automatic_expiry' };
  approvalRequestId: string;
  workflowRunId: string;
  reason: 'cancelled' | 'invalidated';
  resolvedAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'approval.lifecycle',
    actor: input.actor,
    primaryEntity: { kind: 'approval_request', id: input.approvalRequestId },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.resolvedAt,
    sourceId: createAuditSourceId(
      APPROVAL_LIFECYCLE_NAMESPACE,
      [input.approvalRequestId, input.reason, input.resolvedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      approvalRequestId: input.approvalRequestId,
      workflowRunId: input.workflowRunId,
      reason: input.reason,
      resolvedAt: input.resolvedAt.toISOString(),
    },
  };
}

function buildRepairLifecycleInput(input: {
  workspaceId: string;
  actor: { type: 'system'; reason: 'automatic_expiry' };
  repairRequestId: string;
  workflowRunId: string;
  reason: 'cancelled' | 'invalidated';
  resolvedAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'repair.lifecycle',
    actor: input.actor,
    primaryEntity: { kind: 'repair_request', id: input.repairRequestId },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.resolvedAt,
    sourceId: createAuditSourceId(
      REPAIR_LIFECYCLE_NAMESPACE,
      [input.repairRequestId, input.reason, input.resolvedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      repairRequestId: input.repairRequestId,
      workflowRunId: input.workflowRunId,
      reason: input.reason,
      resolvedAt: input.resolvedAt.toISOString(),
    },
  };
}

function buildRunCreatedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  runnerDeviceId: string;
  workflowDigest: string;
  policyVersionId: string;
  policyDigest: string;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_run.created',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    relatedEntities: [
      { kind: 'workflow', id: input.workflowId },
      { kind: 'workflow_version', id: input.workflowVersionId },
      { kind: 'policy_version', id: input.policyVersionId },
    ],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.created,
      [input.runId],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      runnerDeviceId: input.runnerDeviceId,
      workflowDigest: input.workflowDigest,
      policyVersionId: input.policyVersionId,
      policyDigest: input.policyDigest,
    },
  };
}

function buildRunClaimedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  runId: string;
  claimAttemptId: string;
  leaseExpiresAt: Date;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_run.claimed',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.claimed,
      [input.runId, input.claimAttemptId],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      runnerDeviceId: input.actor.runnerDeviceId,
      claimAttemptId: input.claimAttemptId,
      leaseExpiresAt: input.leaseExpiresAt.toISOString(),
    },
  };
}

function buildRunStartedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  runId: string;
  startedAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_run.started',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    occurredAt: input.startedAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.started,
      [input.runId, input.startedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      startedAt: input.startedAt.toISOString(),
    },
  };
}

function buildWaitingForApprovalInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  runId: string;
  stepId: string;
  stepIndex: number;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_run.waiting_for_approval',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.waitingForApproval,
      [input.runId, input.stepId, input.stepIndex],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
    },
  };
}

function buildWaitingForRepairInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  runId: string;
  stepId: string;
  stepIndex: number;
  attemptNumber: number;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_run.waiting_for_repair',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.waitingForRepair,
      [input.runId, input.stepId, input.attemptNumber],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      attemptNumber: input.attemptNumber,
    },
  };
}

function buildRunCancelRequestedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  runId: string;
  requestedAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_run.cancel_requested',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    occurredAt: input.requestedAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.cancelRequested,
      [input.runId, input.requestedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      requestedAt: input.requestedAt.toISOString(),
    },
  };
}

function buildRunTerminalInput(input: {
  workspaceId: string;
  actor: {
    type: 'runner' | 'user' | 'system';
    userId?: string;
    runnerDeviceId?: string;
    reason?:
      | 'automatic_expiry'
      | 'lease_expired'
      | 'completion_reconciliation'
      | 'policy_supersede'
      | 'run_cancelled'
      | 'secret_inventory_sync';
  };
  runId: string;
  terminalStatus:
    'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
  terminationCause?: string;
  finishedAt: Date;
  engineResultDigest?: string;
  durationMs?: number;
  stepCount: number;
  producedOutputCount: number;
}): AuditEventInput {
  const actor: AuditEventInput['actor'] =
    input.actor.type === 'user' && input.actor.userId !== undefined
      ? { type: 'user', userId: input.actor.userId }
      : input.actor.type === 'runner' &&
          input.actor.runnerDeviceId !== undefined
        ? { type: 'runner', runnerDeviceId: input.actor.runnerDeviceId }
        : {
            type: 'system',
            reason: input.actor.reason ?? 'automatic_expiry',
          };
  const eventType =
    input.terminalStatus === 'succeeded'
      ? 'workflow_run.succeeded'
      : input.terminalStatus === 'failed'
        ? 'workflow_run.failed'
        : input.terminalStatus === 'cancelled'
          ? 'workflow_run.cancelled'
          : input.terminalStatus === 'timed_out'
            ? 'workflow_run.timed_out'
            : 'workflow_run.interrupted';
  return {
    workspaceId: input.workspaceId,
    eventType,
    actor,
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    occurredAt: input.finishedAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.terminal,
      [input.runId, eventType, input.finishedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      terminalStatus: input.terminalStatus,
      ...(input.terminationCause === undefined
        ? {}
        : { terminationCause: input.terminationCause }),
      finishedAt: input.finishedAt.toISOString(),
      ...(input.engineResultDigest === undefined
        ? {}
        : { engineResultDigest: input.engineResultDigest }),
      ...(input.durationMs === undefined
        ? {}
        : { durationMs: input.durationMs }),
      stepCount: input.stepCount,
      producedOutputCount: input.producedOutputCount,
    },
  };
}

function buildRunInterruptedInput(input: {
  workspaceId: string;
  runId: string;
  finishedAt: Date;
  stepCount: number;
  producedOutputCount: number;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_run.interrupted',
    actor: { type: 'system', reason: 'lease_expired' },
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    occurredAt: input.finishedAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.interrupted,
      [input.runId, input.finishedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      terminalStatus: 'interrupted',
      terminationCause: 'LEASE_EXPIRED',
      finishedAt: input.finishedAt.toISOString(),
      stepCount: input.stepCount,
      producedOutputCount: input.producedOutputCount,
    },
  };
}

function buildAttemptStartedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  runId: string;
  attemptId: string;
  stepId: string;
  stepIndex: number;
  stepType: string;
  attemptNumber: number;
  trigger: 'initial' | 'automatic_retry' | 'manual_retry';
  effectCertainty:
    | 'not_started'
    | 'read_only'
    | 'side_effect_possible'
    | 'completed'
    | 'unknown';
  authorizedByRepairRequestId: string | null;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'execution.attempt_started',
    actor: input.actor,
    primaryEntity: {
      kind: 'workflow_run_step_attempt',
      id: input.attemptId,
    },
    relatedEntities: [{ kind: 'workflow_run', id: input.runId }],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.attemptStarted,
      [input.attemptId],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      runStepAttemptId: input.attemptId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      stepType: input.stepType as Parameters<
        typeof createAuditSourceId
      >[1][0] extends string
        ? Parameters<typeof createAuditSourceId>[1][0]
        : never,
      attemptNumber: input.attemptNumber,
      trigger: input.trigger,
      effectCertainty: input.effectCertainty,
      ...(input.authorizedByRepairRequestId === null
        ? {}
        : { authorizedByRepairRequestId: input.authorizedByRepairRequestId }),
    },
  };
}

function buildAttemptTerminalInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  runId: string;
  attemptId: string;
  stepId: string;
  stepIndex: number;
  stepType: string;
  attemptNumber: number;
  trigger: 'initial' | 'automatic_retry' | 'manual_retry';
  attemptStatus:
    'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
  effectCertainty:
    | 'not_started'
    | 'read_only'
    | 'side_effect_possible'
    | 'completed'
    | 'unknown';
  safeErrorCode?: string;
  durationMs?: number;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'execution.attempt_terminal',
    actor: input.actor,
    primaryEntity: {
      kind: 'workflow_run_step_attempt',
      id: input.attemptId,
    },
    relatedEntities: [{ kind: 'workflow_run', id: input.runId }],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.attemptTerminal,
      [input.attemptId],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      runStepAttemptId: input.attemptId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      stepType: input.stepType as never,
      attemptNumber: input.attemptNumber,
      trigger: input.trigger,
      attemptStatus: input.attemptStatus,
      effectCertainty: input.effectCertainty,
      ...(input.safeErrorCode === undefined
        ? {}
        : { safeErrorCode: input.safeErrorCode }),
      ...(input.durationMs === undefined
        ? {}
        : { durationMs: input.durationMs }),
    },
  };
}

function buildVerificationCompletedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  runId: string;
  stepId: string;
  stepIndex: number;
  verificationSequence: number;
  verificationKind: string;
  outcome: 'passed' | 'failed';
  attemptCount: number;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'execution.verification_completed',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_run', id: input.runId },
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.verificationCompleted,
      [input.runId, input.stepId, input.verificationSequence],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      verificationSequence: input.verificationSequence,
      verificationKind: input.verificationKind as never,
      outcome: input.outcome,
      attemptCount: input.attemptCount,
    },
  };
}

function buildOutputProducedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  runId: string;
  outputName: string;
  outputType: 'string' | 'boolean';
  producerStepId: string;
  producerStepIndex: number;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'execution.output_produced',
    actor: input.actor,
    primaryEntity: {
      kind: 'workflow_run_output',
      id: `${input.runId}:${input.outputName}`,
    },
    relatedEntities: [{ kind: 'workflow_run', id: input.runId }],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      RUN_EVENT_NAMESPACES.outputProduced,
      [input.runId, input.outputName],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      outputName: input.outputName,
      outputType: input.outputType,
      producerStepId: input.producerStepId,
      producerStepIndex: input.producerStepIndex,
    },
  };
}

const runInclude = {
  workflowVersion: { select: { version: true } },
  steps: {
    orderBy: { sourceStepIndex: 'asc' as const },
    include: { attempts: { orderBy: { attemptNumber: 'asc' as const } } },
  },
  outputs: { orderBy: { producerStepIndex: 'asc' as const } },
  approvalRequests: { orderBy: { requestedAt: 'asc' as const } },
  repairRequests: { orderBy: { requestedAt: 'asc' as const } },
} as const satisfies Prisma.WorkflowRunInclude;

type RunRow = Prisma.WorkflowRunGetPayload<{ include: typeof runInclude }>;

function isSerializationError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2028')
  ) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ('cause' in error) {
    const cause = error.cause;
    if (typeof cause === 'object' && cause !== null) {
      const kind = 'kind' in cause ? cause.kind : undefined;
      const originalCode =
        'originalCode' in cause ? cause.originalCode : undefined;
      if (kind === 'TransactionWriteConflict' || originalCode === '40001') {
        return true;
      }
    }
  }
  if (!('code' in error) || error.code !== 'P2010' || !('meta' in error)) {
    return false;
  }
  const meta = error.meta;
  if (
    typeof meta !== 'object' ||
    meta === null ||
    !('driverAdapterError' in meta)
  ) {
    return false;
  }
  const driverError = meta.driverAdapterError;
  if (
    typeof driverError !== 'object' ||
    driverError === null ||
    !('cause' in driverError)
  ) {
    return false;
  }
  const cause = driverError.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'originalCode' in cause &&
    cause.originalCode === '40001'
  );
}

function toRecord(row: RunRow): WorkflowRunRecord {
  const finalResult = WorkflowExecutionResultSchema.safeParse(row.finalResult);
  const verificationByStep = new Map(
    finalResult.success
      ? finalResult.data.steps.flatMap((step) =>
          step.verification === undefined
            ? []
            : [[step.stepId, step.verification] as const],
        )
      : [],
  );
  const parsedPolicyEvaluation = WorkflowPolicyEvaluationSchema.safeParse(
    row.policyEvaluation,
  );
  const policyEvaluation = parsedPolicyEvaluation.success
    ? parsedPolicyEvaluation.data
    : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    workflowVersion: row.workflowVersion.version,
    runnerDeviceId: row.runnerDeviceId,
    createdByUserId: row.createdByUserId,
    clientRunId: row.clientRunId,
    status: row.status as ProtocolRunStatus,
    definitionDigest: row.definitionDigest,
    policyVersionId: row.policyVersionId,
    policyDigest: row.policyDigest,
    policyDecision: policyEvaluation?.overallDecision ?? null,
    policyHighestRisk: policyEvaluation?.highestRisk ?? null,
    lastProgressSequence: row.lastProgressSequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    claimedAt: row.claimedAt,
    startedAt: row.startedAt,
    cancelRequestedAt: row.cancelRequestedAt,
    finishedAt: row.finishedAt,
    terminationCause: row.terminationCause,
    steps: row.steps.map((step) => ({
      stepId: step.sourceStepId,
      stepIndex: step.sourceStepIndex,
      stepType: step.stepType,
      status: step.status as PersistedRunStepStatus,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs,
      errorCode: step.errorCode,
      skippedReason: step.skippedReason,
      attempts:
        step.attempts.length === 0
          ? []
          : SafeStepAttemptListSchema.parse(
              step.attempts.map((attempt) => ({
                attemptNumber: attempt.attemptNumber,
                trigger: {
                  INITIAL: 'initial',
                  AUTOMATIC_RETRY: 'automatic_retry',
                  MANUAL_RETRY: 'manual_retry',
                }[attempt.trigger],
                status: attempt.status.toLowerCase(),
                startedAt: attempt.startedAt.toISOString(),
                ...(attempt.finishedAt === null
                  ? {}
                  : { finishedAt: attempt.finishedAt.toISOString() }),
                ...(attempt.durationMs === null
                  ? {}
                  : { durationMs: attempt.durationMs }),
                ...(attempt.safeErrorCode === null
                  ? {}
                  : { errorCode: attempt.safeErrorCode }),
                effectCertainty: {
                  NOT_STARTED: 'not_started',
                  READ_ONLY: 'read_only',
                  SIDE_EFFECT_POSSIBLE: 'side_effect_possible',
                  COMPLETED: 'completed',
                  UNKNOWN: 'unknown',
                }[attempt.effectCertainty],
                ...(attempt.authorizedByRepairRequestId === null
                  ? {}
                  : { repairRequestId: attempt.authorizedByRepairRequestId }),
              })),
            ),
      ...(verificationByStep.get(step.sourceStepId) === undefined
        ? {}
        : { verification: verificationByStep.get(step.sourceStepId)! }),
    })),
    outputs: row.outputs.map((output) => ({
      outputName: output.outputName,
      outputType:
        output.outputType === WorkflowRunOutputType.STRING
          ? 'string'
          : 'boolean',
      producerStepId: output.producerStepId,
      producerStepIndex: output.producerStepIndex,
      status:
        output.status === WorkflowRunOutputStatus.PRODUCED
          ? 'produced'
          : 'not_produced',
      producedAt: output.producedAt,
    })),
  };
}

function terminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_STATUSES.includes(
    status as (typeof TERMINAL_STATUSES)[number],
  );
}

function persistedStepStatus(
  status: WorkflowEngineStepStatus,
): WorkflowRunStepStatus {
  switch (status) {
    case 'pending':
      return WorkflowRunStepStatus.PENDING;
    case 'running':
      return WorkflowRunStepStatus.RUNNING;
    case 'waiting_for_approval':
      return WorkflowRunStepStatus.WAITING_FOR_APPROVAL;
    case 'waiting_for_repair':
      return WorkflowRunStepStatus.WAITING_FOR_REPAIR;
    case 'succeeded':
      return WorkflowRunStepStatus.SUCCEEDED;
    case 'failed':
      return WorkflowRunStepStatus.FAILED;
    case 'cancelled':
      return WorkflowRunStepStatus.CANCELLED;
    case 'timed_out':
      return WorkflowRunStepStatus.TIMED_OUT;
    case 'skipped':
      return WorkflowRunStepStatus.SKIPPED;
    case 'interrupted':
      return WorkflowRunStepStatus.INTERRUPTED;
  }
}

function persistedRunStatus(
  status: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted',
): WorkflowRunStatus {
  return {
    succeeded: WorkflowRunStatus.SUCCEEDED,
    failed: WorkflowRunStatus.FAILED,
    cancelled: WorkflowRunStatus.CANCELLED,
    timed_out: WorkflowRunStatus.TIMED_OUT,
    interrupted: WorkflowRunStatus.INTERRUPTED,
  }[status];
}

function persistedAttemptTrigger(
  trigger: string,
): WorkflowRunStepAttemptTrigger {
  return (
    {
      initial: WorkflowRunStepAttemptTrigger.INITIAL,
      automatic_retry: WorkflowRunStepAttemptTrigger.AUTOMATIC_RETRY,
      manual_retry: WorkflowRunStepAttemptTrigger.MANUAL_RETRY,
    }[trigger] ?? WorkflowRunStepAttemptTrigger.INITIAL
  );
}

function persistedAttemptStatus(status: string): WorkflowRunStepAttemptStatus {
  const value =
    status.toUpperCase() as keyof typeof WorkflowRunStepAttemptStatus;
  return WorkflowRunStepAttemptStatus[value];
}

function persistedEffectCertainty(
  certainty: string,
): WorkflowExecutionEffectCertainty {
  const value =
    certainty.toUpperCase() as keyof typeof WorkflowExecutionEffectCertainty;
  return WorkflowExecutionEffectCertainty[value];
}

function parseJsonArray(input: Prisma.JsonValue): string[] {
  if (
    !Array.isArray(input) ||
    !input.every((value) => typeof value === 'string')
  ) {
    throw new WorkflowRunRepositoryError('RUN_CONFLICT');
  }
  return input;
}

function parseOptions(input: Prisma.JsonValue): {
  totalTimeoutMs: number;
  stepTimeoutMs: number;
  recoveryMode:
    | 'automatic_safe_only'
    | 'automatic_safe_and_manual'
    | 'automatic_safe_and_locator_proposals';
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new WorkflowRunRepositoryError('RUN_CONFLICT');
  }
  const totalTimeoutMs = input.totalTimeoutMs;
  const stepTimeoutMs = input.stepTimeoutMs;
  const recoveryMode: unknown = input.recoveryMode ?? 'automatic_safe_only';
  if (
    typeof totalTimeoutMs !== 'number' ||
    typeof stepTimeoutMs !== 'number' ||
    (recoveryMode !== 'automatic_safe_only' &&
      recoveryMode !== 'automatic_safe_and_manual' &&
      recoveryMode !== 'automatic_safe_and_locator_proposals')
  ) {
    throw new WorkflowRunRepositoryError('RUN_CONFLICT');
  }
  return { totalTimeoutMs, stepTimeoutMs, recoveryMode };
}

export class WorkflowRunRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditTrail: WorkspaceAuditTrailRepository = new WorkspaceAuditTrailRepository(
      prisma,
    ),
    private readonly operationalAlerts?: OperationalAlertTransactionAppender,
  ) {}

  async resolveWorkflowRunAccess(
    userId: string,
    workflowRunId: string,
  ): Promise<WorkflowRunAccess | null> {
    const row = await this.prisma.workflowRun.findFirst({
      where: {
        id: workflowRunId,
        workspace: {
          organization: { members: { some: { userId } } },
        },
      },
      select: {
        workspace: {
          select: {
            organization: {
              select: {
                id: true,
                members: {
                  where: { userId },
                  select: { role: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    const role = row?.workspace.organization.members[0]?.role;
    return row === null || row === undefined || role === undefined
      ? null
      : {
          organizationId: row.workspace.organization.id,
          userId,
          role,
        };
  }

  createRun(input: {
    actorUserId: string;
    workflowVersionId: string;
    runnerDeviceId: string;
    clientRunId: string;
    options: {
      totalTimeoutMs: number;
      stepTimeoutMs: number;
      recoveryMode:
        | 'automatic_safe_only'
        | 'automatic_safe_and_manual'
        | 'automatic_safe_and_locator_proposals';
    };
  }): Promise<CreateWorkflowRunResult> {
    return this.runSerializable(async (transaction) => {
      const version = await transaction.workflowVersion.findFirst({
        where: {
          id: input.workflowVersionId,
          workflow: {
            workspace: {
              organization: {
                members: { some: { userId: input.actorUserId } },
              },
            },
          },
        },
        select: {
          id: true,
          workflowId: true,
          version: true,
          status: true,
          schemaVersion: true,
          definition: true,
          workflow: { select: { workspaceId: true } },
        },
      });
      if (version === null) {
        throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
      }
      const access = await this.resolveWorkspaceAccess(
        transaction,
        input.actorUserId,
        version.workflow.workspaceId,
      );
      if (
        access === null ||
        !WRITER_ROLES.includes(access.role as (typeof WRITER_ROLES)[number])
      ) {
        throw new WorkflowRunRepositoryError('RUN_FORBIDDEN');
      }

      const existing = await transaction.workflowRun.findUnique({
        where: {
          workspaceId_clientRunId: {
            workspaceId: version.workflow.workspaceId,
            clientRunId: input.clientRunId,
          },
        },
        include: runInclude,
      });
      if (existing !== null) {
        if (
          existing.workflowVersionId !== input.workflowVersionId ||
          existing.runnerDeviceId !== input.runnerDeviceId
        ) {
          throw new WorkflowRunRepositoryError('RUN_CONFLICT');
        }
        const definition = WorkflowDefinitionSchema.parse(version.definition);
        return {
          run: toRecord(existing),
          idempotent: true,
          readiness: analyzeWorkflowRunReadiness(definition),
        };
      }

      const runner = await transaction.runnerDevice.findFirst({
        where: {
          id: input.runnerDeviceId,
          workspaceId: version.workflow.workspaceId,
        },
        select: { revokedAt: true, capabilities: true },
      });
      if (runner === null) {
        throw new WorkflowRunRepositoryError('RUNNER_MISMATCH');
      }
      if (runner.revokedAt !== null) {
        throw new WorkflowRunRepositoryError('RUNNER_REVOKED');
      }

      const parsed = WorkflowDefinitionSchema.safeParse(version.definition);
      if (
        !parsed.success ||
        version.status !== 'published' ||
        version.schemaVersion !== 1 ||
        parsed.data.workflowId !== version.workflowId ||
        parsed.data.version !== version.version ||
        parsed.data.status !== 'published'
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY');
      }
      const readiness = analyzeWorkflowRunReadiness(parsed.data);
      if (!readiness.ready) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', readiness);
      }
      const activePolicy =
        await transaction.workspaceExecutionPolicyVersion.findFirst({
          where: {
            workspaceId: version.workflow.workspaceId,
            status: 'ACTIVE',
          },
          select: { id: true, revision: true, digest: true, definition: true },
        });
      const parsedPolicy = WorkspaceExecutionPolicyDefinitionSchema.safeParse(
        activePolicy?.definition,
      );
      if (activePolicy === null || !parsedPolicy.success) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY');
      }
      const definitionDigest = createCanonicalJsonDigest(parsed.data);
      const policyEvaluation = evaluateWorkflowPolicy({
        policy: parsedPolicy.data,
        workflow: parsed.data,
        policyDigest: activePolicy.digest,
        workflowDigest: definitionDigest,
      });
      if (
        policyEvaluation.overallDecision === 'deny' ||
        policyEvaluation.hasBlockingIssues
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', policyEvaluation);
      }
      if (
        parsed.data.steps.some((step) => step.type === 'verify') &&
        !runner.capabilities.includes(WORKFLOW_VERIFICATION_CAPABILITY)
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message: 'The selected Runner cannot execute Verify steps.',
            },
          ],
        });
      }
      if (
        parsed.data.steps.some((step) => step.type === 'extract') &&
        !runner.capabilities.includes(WORKFLOW_EXTRACTION_CAPABILITY)
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message: 'The selected Runner cannot execute Extract steps.',
            },
          ],
        });
      }
      if (
        parsed.data.steps.some((step) => step.type === 'approval') &&
        !runner.capabilities.includes(WORKFLOW_APPROVAL_CAPABILITY)
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message: 'The selected Runner cannot coordinate Approval steps.',
            },
          ],
        });
      }
      if (
        input.options.recoveryMode === 'automatic_safe_and_manual' &&
        !runner.capabilities.includes(WORKFLOW_MANUAL_REPAIR_CAPABILITY)
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message:
                'The selected Runner does not support attended manual repair.',
            },
          ],
        });
      }
      if (
        input.options.recoveryMode === 'automatic_safe_and_locator_proposals' &&
        !runner.capabilities.includes('locator_repair_proposals_v1')
      ) {
        throw new WorkflowRunRepositoryError('RUN_NOT_READY', {
          ...readiness,
          ready: false,
          issues: [
            ...readiness.issues,
            {
              code: 'RUNNER_CAPABILITY_UNAVAILABLE',
              message:
                'The selected Runner does not support locator repair proposals.',
            },
          ],
        });
      }
      const outputDefinitions = defineWorkflowOutputs(parsed.data);
      const executionOptions = input.options;
      const created = await transaction.workflowRun.create({
        data: {
          workspaceId: version.workflow.workspaceId,
          workflowId: version.workflowId,
          workflowVersionId: version.id,
          runnerDeviceId: input.runnerDeviceId,
          createdByUserId: input.actorUserId,
          clientRunId: input.clientRunId,
          runProtocolVersion: RUN_PROTOCOL_VERSION,
          workflowEngineVersion: 1,
          definitionDigest,
          policyVersionId: activePolicy.id,
          policyDigest: activePolicy.digest,
          policyEvaluation: policyEvaluation as Prisma.InputJsonValue,
          allowedOrigins: readiness.allowedOrigins,
          executionOptions,
          steps: {
            create: parsed.data.steps.map((step, index) => ({
              sourceStepId: step.id,
              sourceStepIndex: index,
              stepType: step.type,
            })),
          },
          outputs: {
            create: outputDefinitions.map((output) => ({
              outputName: output.name,
              outputType:
                output.valueType === 'string'
                  ? WorkflowRunOutputType.STRING
                  : WorkflowRunOutputType.BOOLEAN,
              producerStepId: output.producerStepId,
              producerStepIndex: output.producerStepIndex,
            })),
          },
        },
        include: runInclude,
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildRunCreatedInput({
          workspaceId: version.workflow.workspaceId,
          actor: { type: 'user', userId: input.actorUserId },
          runId: created.id,
          workflowId: version.workflowId,
          workflowVersionId: version.id,
          runnerDeviceId: input.runnerDeviceId,
          workflowDigest: definitionDigest,
          policyVersionId: activePolicy.id,
          policyDigest: activePolicy.digest,
          occurredAt: new Date(),
        }),
      );
      return { run: toRecord(created), idempotent: false, readiness };
    });
  }

  claim(input: {
    runnerDeviceId: string;
    runnerVersion: string;
    runProtocolVersion: number;
    workflowSchemaVersion: number;
    claimAttemptId: string;
    leaseTokenHash: string;
    now: Date;
    leaseExpiresAt: Date;
    secretInventory?: LocalSecretInventoryPin;
  }): Promise<ClaimWorkflowRunResult> {
    return this.runSerializable(async (transaction) => {
      const runner = await transaction.runnerDevice.findUnique({
        where: { id: input.runnerDeviceId },
        select: {
          revokedAt: true,
          runnerVersion: true,
          platform: true,
          architecture: true,
          runProtocolVersion: true,
          workflowSchemaVersion: true,
          localStateSchemaVersion: true,
          secretInventory: {
            select: {
              vaultId: true,
              vaultRevision: true,
              inventoryDigest: true,
              storeStatus: true,
            },
          },
        },
      });
      if (runner === null || runner.revokedAt !== null) {
        throw new WorkflowRunRepositoryError('RUNNER_REVOKED');
      }
      const compatibility = evaluatePersistedRunnerCompatibility(runner);
      if (
        !canRunnerClaimJobs(compatibility) ||
        input.runnerVersion !== runner.runnerVersion ||
        input.runProtocolVersion !== runner.runProtocolVersion ||
        input.workflowSchemaVersion !== runner.workflowSchemaVersion
      ) {
        return { status: 'no_job' };
      }

      const retried = await transaction.workflowRun.findUnique({
        where: {
          runnerDeviceId_claimAttemptId: {
            runnerDeviceId: input.runnerDeviceId,
            claimAttemptId: input.claimAttemptId,
          },
        },
        select: {
          id: true,
          status: true,
          leaseTokenHash: true,
          leaseExpiresAt: true,
          runProtocolVersion: true,
          definitionDigest: true,
          allowedOrigins: true,
          executionOptions: true,
          workflowVersion: { select: { definition: true } },
          policyVersion: {
            select: {
              id: true,
              revision: true,
              definition: true,
              digest: true,
            },
          },
          policyDigest: true,
          policyEvaluation: true,
          secretResolutionMode: true,
          secretVaultId: true,
          secretInventoryRevision: true,
          secretInventoryDigest: true,
          inputEnvelope: {
            include: {
              preparation: {
                select: {
                  variableManifest: true,
                  secretManifest: true,
                  aad: true,
                },
              },
            },
          },
        },
      });
      if (retried !== null) {
        if (
          !ACTIVE_STATUSES.includes(
            retried.status as (typeof ACTIVE_STATUSES)[number],
          ) ||
          retried.leaseTokenHash !== input.leaseTokenHash ||
          retried.leaseExpiresAt === null ||
          retried.runProtocolVersion !== input.runProtocolVersion
        ) {
          throw new WorkflowRunRepositoryError('RUN_CONFLICT');
        }
        if (retried.leaseExpiresAt.getTime() <= input.now.getTime()) {
          await this.interruptLockedRun(transaction, retried.id, input.now);
          return { status: 'no_job' };
        }
        return this.claimedRecord(retried, true);
      }

      const active = await transaction.workflowRun.findFirst({
        where: {
          runnerDeviceId: input.runnerDeviceId,
          status: { in: [...ACTIVE_STATUSES] },
        },
        select: { id: true, leaseExpiresAt: true },
      });
      if (active !== null) {
        if (
          active.leaseExpiresAt !== null &&
          active.leaseExpiresAt.getTime() <= input.now.getTime()
        ) {
          await this.lockRun(transaction, active.id);
          await this.interruptLockedRun(transaction, active.id, input.now);
        } else {
          return { status: 'no_job' };
        }
      }

      const ids = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "workflow_runs"
        WHERE "runner_device_id" = ${input.runnerDeviceId}::uuid
          AND "status" = 'QUEUED'
          AND "run_protocol_version" = ${input.runProtocolVersion}
        ORDER BY "created_at" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const runId = ids[0]?.id;
      if (runId === undefined) {
        return { status: 'no_job' };
      }
      const queued = await transaction.workflowRun.findUnique({
        where: { id: runId },
        select: {
          policyVersionId: true,
          workspaceId: true,
          createdByUserId: true,
          steps: { select: { id: true } },
          outputs: { select: { status: true } },
          secretResolutionMode: true,
          secretVaultId: true,
          secretInventoryRevision: true,
          secretInventoryDigest: true,
          scheduleId: true,
          occurrenceId: true,
          scheduledFor: true,
          schedule: { select: { createdByUserId: true } },
          workspace: {
            select: {
              executionPolicyVersions: {
                where: { status: 'ACTIVE' },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });
      const pinnedSecretInventory =
        queued?.secretResolutionMode === 'LOCAL_STORE' &&
        queued.secretVaultId !== null &&
        queued.secretInventoryRevision !== null &&
        queued.secretInventoryDigest !== null
          ? {
              schemaVersion: 1 as const,
              vaultId: queued.secretVaultId,
              vaultRevision: queued.secretInventoryRevision,
              inventoryDigest: queued.secretInventoryDigest,
            }
          : undefined;
      const currentInventory = runner.secretInventory;
      const secretInventoryMatches =
        pinnedSecretInventory === undefined ||
        (input.secretInventory !== undefined &&
          currentInventory?.storeStatus === 'READY' &&
          input.secretInventory.vaultId === pinnedSecretInventory.vaultId &&
          input.secretInventory.vaultRevision ===
            pinnedSecretInventory.vaultRevision &&
          input.secretInventory.inventoryDigest ===
            pinnedSecretInventory.inventoryDigest &&
          currentInventory.vaultId === pinnedSecretInventory.vaultId &&
          currentInventory.vaultRevision ===
            pinnedSecretInventory.vaultRevision &&
          currentInventory.inventoryDigest ===
            pinnedSecretInventory.inventoryDigest);
      if (queued !== null && !secretInventoryMatches) {
        await transaction.workflowRun.update({
          where: { id: runId },
          data: {
            status: WorkflowRunStatus.FAILED,
            finishedAt: input.now,
            terminationCause: 'secret_inventory_changed_before_execution',
            steps: {
              updateMany: {
                where: { status: WorkflowRunStepStatus.PENDING },
                data: {
                  status: WorkflowRunStepStatus.SKIPPED,
                  finishedAt: input.now,
                  skippedReason: 'secret_inventory_changed_before_execution',
                },
              },
            },
          },
        });
        if (queued.scheduleId !== null) {
          await transaction.workflowSchedule.update({
            where: { id: queued.scheduleId },
            data: {
              status: 'AUTO_PAUSED',
              autoPauseReason: 'secret_readiness_failed',
              autoPausedAt: input.now,
              autoPausedByOccurrenceId: queued.occurrenceId,
              nextOccurrenceAt: null,
            },
          });
          if (queued.occurrenceId !== null) {
            await transaction.workflowScheduleOccurrence.updateMany({
              where: { id: queued.occurrenceId },
              data: {
                status: 'SKIPPED',
                skipReason: 'secret_inventory_changed_before_execution',
                skippedAt: input.now,
                completedAt: input.now,
                terminationCause: 'secret_inventory_changed_before_execution',
              },
            });
            await appendAuditEventTransactional(transaction, this.auditTrail, {
              workspaceId: queued.workspaceId,
              eventType: 'schedule.occurrence.skipped',
              actor: { type: 'system', reason: 'scheduler' },
              primaryEntity: {
                kind: 'workflow_schedule_occurrence',
                id: queued.occurrenceId,
              },
              relatedEntities: [
                { kind: 'workflow_schedule', id: queued.scheduleId },
                { kind: 'workflow_run', id: runId },
              ],
              occurredAt: input.now,
              sourceId: createAuditSourceId(
                'schedule_occurrence_secret_inventory_changed',
                [queued.occurrenceId, runId],
                auditHasherForTrail,
              ),
              payload: {
                scheduleId: queued.scheduleId,
                occurrenceId: queued.occurrenceId,
                scheduledFor: queued.scheduledFor ?? input.now,
                skipReason: 'secret_inventory_changed_before_execution',
                skippedAt: input.now,
              },
            });
          }
          await appendAuditEventTransactional(transaction, this.auditTrail, {
            workspaceId: queued.workspaceId,
            eventType: 'schedule.auto_paused',
            actor: { type: 'system', reason: 'automatic' },
            primaryEntity: { kind: 'workflow_schedule', id: queued.scheduleId },
            ...(queued.occurrenceId === null
              ? {}
              : {
                  relatedEntities: [
                    {
                      kind: 'workflow_schedule_occurrence' as const,
                      id: queued.occurrenceId,
                    },
                  ],
                }),
            occurredAt: input.now,
            sourceId: createAuditSourceId(
              'schedule_secret_inventory_auto_paused',
              [queued.scheduleId, queued.occurrenceId ?? runId],
              auditHasherForTrail,
            ),
            payload: {
              scheduleId: queued.scheduleId,
              reason: 'secret_readiness_failed',
              autoPausedAt: input.now,
              ...(queued.occurrenceId === null
                ? {}
                : { triggeringOccurrenceId: queued.occurrenceId }),
            },
          });
          await this.operationalAlerts?.append(transaction, {
            schemaVersion: 1,
            workspaceId: queued.workspaceId,
            type: 'schedule_auto_paused',
            source: { type: 'workflow_schedule', id: queued.scheduleId },
            primaryEntity: { type: 'workflow_schedule', id: queued.scheduleId },
            relatedEntities:
              queued.occurrenceId === null
                ? []
                : [
                    {
                      type: 'workflow_schedule_occurrence',
                      id: queued.occurrenceId,
                    },
                  ],
            template: {
              schemaVersion: 1,
              templateKey: 'schedule_auto_paused.v1',
              workflowScheduleId: queued.scheduleId,
              reason: 'secret_readiness_failed',
              autoPausedAt: input.now.toISOString(),
              ...(queued.occurrenceId === null
                ? {}
                : { occurrenceId: queued.occurrenceId }),
            },
            actionTarget: {
              schemaVersion: 1,
              kind: 'schedule',
              workspaceId: queued.workspaceId,
              workflowScheduleId: queued.scheduleId,
            },
            creatorUserId:
              queued.schedule?.createdByUserId ?? queued.createdByUserId,
          });
        }
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildRunTerminalInput({
            workspaceId: queued.workspaceId,
            actor: { type: 'system', reason: 'secret_inventory_sync' },
            runId,
            terminalStatus: 'failed',
            terminationCause: 'secret_inventory_changed_before_execution',
            finishedAt: input.now,
            stepCount: queued.steps.length,
            producedOutputCount: queued.outputs.filter(
              (output) => output.status === WorkflowRunOutputStatus.PRODUCED,
            ).length,
          }),
        );
        await this.operationalAlerts?.append(transaction, {
          schemaVersion: 1,
          workspaceId: queued.workspaceId,
          type: 'run_failed',
          source: { type: 'workflow_run', id: runId },
          primaryEntity: { type: 'workflow_run', id: runId },
          relatedEntities: [],
          template: {
            schemaVersion: 1,
            templateKey: 'run_failed.v1',
            workflowRunId: runId,
            failedAt: input.now.toISOString(),
          },
          actionTarget: {
            schemaVersion: 1,
            kind: 'run',
            workspaceId: queued.workspaceId,
            workflowRunId: runId,
          },
          creatorUserId: queued.createdByUserId,
        });
        return { status: 'no_job' };
      }
      if (
        queued === null ||
        queued.policyVersionId === null ||
        queued.workspace.executionPolicyVersions[0]?.id !==
          queued.policyVersionId
      ) {
        await transaction.workflowRun.update({
          where: { id: runId },
          data: {
            status: WorkflowRunStatus.FAILED,
            finishedAt: input.now,
            terminationCause: 'policy_changed_before_execution',
            steps: {
              updateMany: {
                where: { status: WorkflowRunStepStatus.PENDING },
                data: {
                  status: WorkflowRunStepStatus.SKIPPED,
                  finishedAt: input.now,
                  skippedReason: 'policy_changed_before_execution',
                },
              },
            },
          },
        });
        if (queued !== null) {
          await appendAuditEventTransactional(
            transaction,
            this.auditTrail,
            buildRunTerminalInput({
              workspaceId: queued.workspaceId,
              actor: { type: 'system', reason: 'policy_supersede' },
              runId,
              terminalStatus: 'failed',
              terminationCause: 'policy_changed_before_execution',
              finishedAt: input.now,
              stepCount: queued.steps.length,
              producedOutputCount: queued.outputs.filter(
                (output) => output.status === WorkflowRunOutputStatus.PRODUCED,
              ).length,
            }),
          );
          await this.operationalAlerts?.append(transaction, {
            schemaVersion: 1,
            workspaceId: queued.workspaceId,
            type: 'run_failed',
            source: { type: 'workflow_run', id: runId },
            primaryEntity: { type: 'workflow_run', id: runId },
            relatedEntities: [],
            template: {
              schemaVersion: 1,
              templateKey: 'run_failed.v1',
              workflowRunId: runId,
              failedAt: input.now.toISOString(),
            },
            actionTarget: {
              schemaVersion: 1,
              kind: 'run',
              workspaceId: queued.workspaceId,
              workflowRunId: runId,
            },
            creatorUserId: queued.createdByUserId,
          });
        }
        return { status: 'no_job' };
      }
      const row = await transaction.workflowRun.update({
        where: { id: runId },
        data: {
          status: WorkflowRunStatus.CLAIMED,
          claimAttemptId: input.claimAttemptId,
          leaseTokenHash: input.leaseTokenHash,
          leaseExpiresAt: input.leaseExpiresAt,
          claimedAt: input.now,
        },
        select: {
          id: true,
          workspaceId: true,
          status: true,
          leaseTokenHash: true,
          leaseExpiresAt: true,
          runProtocolVersion: true,
          definitionDigest: true,
          allowedOrigins: true,
          executionOptions: true,
          workflowVersion: { select: { definition: true } },
          policyVersion: {
            select: {
              id: true,
              revision: true,
              definition: true,
              digest: true,
            },
          },
          policyDigest: true,
          policyEvaluation: true,
          inputEnvelope: {
            include: {
              preparation: {
                select: {
                  variableManifest: true,
                  secretManifest: true,
                  aad: true,
                },
              },
            },
          },
          secretResolutionMode: true,
          secretVaultId: true,
          secretInventoryRevision: true,
          secretInventoryDigest: true,
        },
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildRunClaimedInput({
          workspaceId: row.workspaceId,
          actor: { type: 'runner', runnerDeviceId: input.runnerDeviceId },
          runId: row.id,
          claimAttemptId: input.claimAttemptId,
          leaseExpiresAt: input.leaseExpiresAt,
          occurredAt: input.now,
        }),
      );
      return this.claimedRecord(row, false);
    });
  }

  async renewLease(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<{ leaseExpiresAt: Date; cancelRequested: boolean }> {
    await this.expireRunIfRequired(input.workflowRunId, input.now);
    return this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, input.workflowRunId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: input.workflowRunId },
        select: {
          runnerDeviceId: true,
          status: true,
          leaseTokenHash: true,
          leaseExpiresAt: true,
          runnerDevice: {
            select: {
              revokedAt: true,
              credential: { select: { revokedAt: true } },
            },
          },
        },
      });
      this.requireLease(run, input, input.now);
      const updated = await transaction.workflowRun.update({
        where: { id: input.workflowRunId },
        data: { leaseExpiresAt: input.leaseExpiresAt },
        select: { leaseExpiresAt: true, status: true },
      });
      return {
        leaseExpiresAt: updated.leaseExpiresAt!,
        cancelRequested: updated.status === WorkflowRunStatus.CANCEL_REQUESTED,
      };
    });
  }

  async ingestProgress(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    batch: WorkflowProgressBatch;
    payloadDigest: string;
    now: Date;
  }): Promise<ProgressBatchResult> {
    await this.expireRunIfRequired(input.workflowRunId, input.now);
    return this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, input.workflowRunId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: input.workflowRunId },
        include: runInclude,
      });
      this.requireLease(run, input, input.now);
      if (run === null) {
        throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
      }
      const existing = await transaction.workflowRunProgressBatch.findUnique({
        where: {
          workflowRunId_clientBatchId: {
            workflowRunId: run.id,
            clientBatchId: input.batch.clientBatchId,
          },
        },
      });
      if (existing !== null) {
        if (
          existing.payloadDigest !== input.payloadDigest ||
          existing.firstSequence !== input.batch.firstSequence ||
          existing.lastSequence !== input.batch.lastSequence
        ) {
          throw new WorkflowRunRepositoryError('PROGRESS_BATCH_CONFLICT');
        }
        return {
          acceptedThroughSequence: existing.lastSequence,
          idempotent: true,
          cancelRequested: run.status === WorkflowRunStatus.CANCEL_REQUESTED,
        };
      }
      if (input.batch.firstSequence !== run.lastProgressSequence + 1) {
        throw new WorkflowRunRepositoryError('PROGRESS_SEQUENCE_INVALID');
      }

      let lastEngineStatus = run.lastEngineStatus;
      const stepById = new Map(
        run.steps.map((step) => [step.sourceStepId, step]),
      );
      const outputByName = new Map(
        run.outputs.map((output) => [output.outputName, output]),
      );
      let startedAt = run.startedAt;
      let waitingApprovalEmittedFor: string | null = null;
      let waitingRepairEmittedFor: string | null = null;
      for (const item of input.batch.events) {
        const event = item.event;
        if (event.executionId !== run.id) {
          throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
        }
        if (event.kind === 'run_status_changed') {
          if (!this.validEngineRunTransition(lastEngineStatus, event.status)) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          lastEngineStatus = event.status;
          const timestamp = new Date(event.timestamp);
          if (
            event.status === 'running' &&
            (run.status === WorkflowRunStatus.CLAIMED ||
              run.status === WorkflowRunStatus.WAITING_FOR_APPROVAL ||
              run.status === WorkflowRunStatus.WAITING_FOR_REPAIR)
          ) {
            run.status = WorkflowRunStatus.RUNNING;
            if (startedAt === null) {
              startedAt = timestamp;
              run.startedAt = timestamp;
              await appendAuditEventTransactional(
                transaction,
                this.auditTrail,
                buildRunStartedInput({
                  workspaceId: run.workspaceId,
                  actor: {
                    type: 'runner',
                    runnerDeviceId: input.runnerDeviceId,
                  },
                  runId: run.id,
                  startedAt: timestamp,
                }),
              );
            }
          }
          if (
            event.status === 'waiting_for_approval' &&
            run.status === WorkflowRunStatus.RUNNING
          ) {
            run.status = WorkflowRunStatus.WAITING_FOR_APPROVAL;
            if (waitingApprovalEmittedFor === null) {
              waitingApprovalEmittedFor = `${run.id}:${timestamp.toISOString()}`;
              const approvalStep = [...stepById.values()]
                .reverse()
                .find((step) => step.stepType === 'approval');
              if (approvalStep !== undefined) {
                await appendAuditEventTransactional(
                  transaction,
                  this.auditTrail,
                  buildWaitingForApprovalInput({
                    workspaceId: run.workspaceId,
                    actor: {
                      type: 'runner',
                      runnerDeviceId: input.runnerDeviceId,
                    },
                    runId: run.id,
                    stepId: approvalStep.sourceStepId,
                    stepIndex: approvalStep.sourceStepIndex,
                    occurredAt: timestamp,
                  }),
                );
              }
            }
          }
          if (
            event.status === 'waiting_for_repair' &&
            run.status === WorkflowRunStatus.RUNNING
          ) {
            run.status = WorkflowRunStatus.WAITING_FOR_REPAIR;
            if (waitingRepairEmittedFor === null) {
              waitingRepairEmittedFor = `${run.id}:${timestamp.toISOString()}`;
              const repairStep = [...stepById.values()]
                .reverse()
                .find((step) =>
                  run.repairRequests.some(
                    (request) => request.stepId === step.sourceStepId,
                  ),
                );
              const latestRepair = [...run.repairRequests]
                .reverse()
                .find((request) =>
                  repairStep !== undefined
                    ? request.stepId === repairStep.sourceStepId
                    : false,
                );
              if (repairStep !== undefined && latestRepair !== undefined) {
                await appendAuditEventTransactional(
                  transaction,
                  this.auditTrail,
                  buildWaitingForRepairInput({
                    workspaceId: run.workspaceId,
                    actor: {
                      type: 'runner',
                      runnerDeviceId: input.runnerDeviceId,
                    },
                    runId: run.id,
                    stepId: repairStep.sourceStepId,
                    stepIndex: repairStep.sourceStepIndex,
                    attemptNumber: latestRepair.attemptNumber,
                    occurredAt: timestamp,
                  }),
                );
              }
            }
          }
          continue;
        }
        if (event.kind === 'warning') {
          continue;
        }
        if (event.kind === 'output_produced') {
          const output = outputByName.get(event.outputName);
          const expectedType =
            event.outputType === 'string'
              ? WorkflowRunOutputType.STRING
              : WorkflowRunOutputType.BOOLEAN;
          const producerStep = stepById.get(event.producerStepId);
          if (
            output === undefined ||
            output.producerStepId !== event.producerStepId ||
            output.outputType !== expectedType ||
            output.status !== WorkflowRunOutputStatus.NOT_PRODUCED ||
            producerStep?.status !== WorkflowRunStepStatus.RUNNING
          ) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          output.status = WorkflowRunOutputStatus.PRODUCED;
          output.producedAt = new Date(event.timestamp);
          await appendAuditEventTransactional(
            transaction,
            this.auditTrail,
            buildOutputProducedInput({
              workspaceId: run.workspaceId,
              actor: {
                type: 'runner',
                runnerDeviceId: input.runnerDeviceId,
              },
              runId: run.id,
              outputName: event.outputName,
              outputType: event.outputType,
              producerStepId: event.producerStepId,
              producerStepIndex: producerStep.sourceStepIndex,
              occurredAt: new Date(event.timestamp),
            }),
          );
          continue;
        }
        if (event.kind === 'approval_status_changed') {
          const request = run.approvalRequests.find(
            (candidate) => candidate.approvalStepId === event.approvalStepId,
          );
          if (
            event.status !== 'PENDING' &&
            (request === undefined ||
              request.gatedStepId !== event.gatedStepId ||
              request.status !== event.status)
          ) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          continue;
        }
        if (event.kind === 'repair_status_changed') {
          const request = run.repairRequests.find(
            (candidate) =>
              candidate.stepId === event.stepId &&
              candidate.attemptNumber === event.attemptNumber,
          );
          if (
            request === undefined ||
            request.status !== event.status ||
            request.retryAllowed !== event.retryAllowed ||
            request.safeErrorCode !== event.errorCode
          ) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          continue;
        }
        if (event.kind === 'step_attempt_status_changed') {
          const step = stepById.get(event.stepId);
          if (step === undefined) {
            throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
          }
          if (event.status === 'running') {
            if (event.attemptNumber !== step.attempts.length + 1) {
              throw new WorkflowRunRepositoryError(
                'PROGRESS_TRANSITION_INVALID',
              );
            }
            const expectedTrigger =
              event.attemptNumber === 1
                ? 'initial'
                : event.trigger === 'initial'
                  ? null
                  : event.trigger;
            if (expectedTrigger === null) {
              throw new WorkflowRunRepositoryError(
                'PROGRESS_TRANSITION_INVALID',
              );
            }
            let repairRequestId: string | null = null;
            if (event.trigger === 'manual_retry') {
              const request = run.repairRequests.find(
                (candidate) =>
                  candidate.stepId === event.stepId &&
                  candidate.attemptNumber === event.attemptNumber - 1 &&
                  candidate.status ===
                    WorkflowRepairRequestStatus.RETRY_APPROVED,
              );
              if (request === undefined) {
                throw new WorkflowRunRepositoryError(
                  'PROGRESS_TRANSITION_INVALID',
                );
              }
              repairRequestId = request.id;
            }
            const created = await transaction.workflowRunStepAttempt.create({
              data: {
                workflowRunId: run.id,
                workflowRunStepId: step.id,
                attemptNumber: event.attemptNumber,
                trigger: persistedAttemptTrigger(event.trigger),
                status: WorkflowRunStepAttemptStatus.RUNNING,
                startedAt: new Date(event.timestamp),
                effectCertainty: persistedEffectCertainty(
                  event.effectCertainty,
                ),
                authorizedByRepairRequestId: repairRequestId,
              },
            });
            step.attempts.push(created);
            await appendAuditEventTransactional(
              transaction,
              this.auditTrail,
              buildAttemptStartedInput({
                workspaceId: run.workspaceId,
                actor: {
                  type: 'runner',
                  runnerDeviceId: input.runnerDeviceId,
                },
                runId: run.id,
                attemptId: created.id,
                stepId: event.stepId,
                stepIndex: step.sourceStepIndex,
                stepType: step.stepType,
                attemptNumber: event.attemptNumber,
                trigger: event.trigger,
                effectCertainty: event.effectCertainty,
                authorizedByRepairRequestId: repairRequestId,
                occurredAt: new Date(event.timestamp),
              }),
            );
          } else {
            const attempt = step.attempts.find(
              (candidate) => candidate.attemptNumber === event.attemptNumber,
            );
            if (
              attempt === undefined ||
              attempt.status !== WorkflowRunStepAttemptStatus.RUNNING ||
              persistedAttemptTrigger(event.trigger) !== attempt.trigger
            ) {
              throw new WorkflowRunRepositoryError(
                'PROGRESS_TRANSITION_INVALID',
              );
            }
            const finishedAt = new Date(event.timestamp);
            const updated = await transaction.workflowRunStepAttempt.update({
              where: { id: attempt.id },
              data: {
                status: persistedAttemptStatus(event.status),
                finishedAt,
                durationMs: Math.max(
                  0,
                  finishedAt.getTime() - attempt.startedAt.getTime(),
                ),
                safeErrorCode: event.errorCode ?? null,
                effectCertainty: persistedEffectCertainty(
                  event.effectCertainty,
                ),
              },
            });
            Object.assign(attempt, updated);
            await appendAuditEventTransactional(
              transaction,
              this.auditTrail,
              buildAttemptTerminalInput({
                workspaceId: run.workspaceId,
                actor: {
                  type: 'runner',
                  runnerDeviceId: input.runnerDeviceId,
                },
                runId: run.id,
                attemptId: attempt.id,
                stepId: event.stepId,
                stepIndex: step.sourceStepIndex,
                stepType: step.stepType,
                attemptNumber: event.attemptNumber,
                trigger: event.trigger,
                attemptStatus: event.status,
                effectCertainty: event.effectCertainty,
                ...(event.errorCode === undefined
                  ? {}
                  : { safeErrorCode: event.errorCode }),
                durationMs: Math.max(
                  0,
                  finishedAt.getTime() - attempt.startedAt.getTime(),
                ),
                occurredAt: finishedAt,
              }),
            );
          }
          continue;
        }
        const step = stepById.get(event.stepId);
        if (
          step === undefined ||
          step.stepType !== event.stepType ||
          !this.validEngineStepTransition(step.lastEngineStatus, event.status)
        ) {
          throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
        }
        const next = persistedStepStatus(event.status);
        if (
          step.status !== next &&
          !canTransitionRunStep(
            step.status as PersistedRunStepStatus,
            next as PersistedRunStepStatus,
          )
        ) {
          throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
        }
        if (
          next === WorkflowRunStepStatus.RUNNING &&
          run.steps.some(
            (candidate) =>
              candidate.id !== step.id &&
              candidate.status === WorkflowRunStepStatus.RUNNING,
          )
        ) {
          throw new WorkflowRunRepositoryError('PROGRESS_TRANSITION_INVALID');
        }
        step.lastEngineStatus = event.status;
        step.status = next;
        if (event.status === 'running') {
          step.startedAt = new Date(event.timestamp);
        }
        if (
          [
            'succeeded',
            'failed',
            'cancelled',
            'timed_out',
            'skipped',
            'interrupted',
          ].includes(event.status)
        ) {
          step.finishedAt = new Date(event.timestamp);
        }
        step.errorCode = event.errorCode ?? null;
        step.skippedReason = event.skippedReason ?? null;
      }

      for (const step of run.steps) {
        await transaction.workflowRunStep.update({
          where: { id: step.id },
          data: {
            status: step.status,
            lastEngineStatus: step.lastEngineStatus,
            startedAt: step.startedAt,
            finishedAt: step.finishedAt,
            errorCode: step.errorCode,
            skippedReason: step.skippedReason,
          },
        });
      }
      for (const output of run.outputs) {
        await transaction.workflowRunOutput.update({
          where: { id: output.id },
          data: { status: output.status, producedAt: output.producedAt },
        });
      }
      await transaction.workflowRunProgressBatch.create({
        data: {
          workflowRunId: run.id,
          clientBatchId: input.batch.clientBatchId,
          firstSequence: input.batch.firstSequence,
          lastSequence: input.batch.lastSequence,
          eventCount: input.batch.events.length,
          payloadDigest: input.payloadDigest,
        },
      });
      await transaction.workflowRun.update({
        where: { id: run.id },
        data: {
          status: run.status,
          startedAt: run.startedAt,
          lastEngineStatus,
          lastProgressSequence: input.batch.lastSequence,
        },
      });
      return {
        acceptedThroughSequence: input.batch.lastSequence,
        idempotent: false,
        cancelRequested: run.status === WorkflowRunStatus.CANCEL_REQUESTED,
      };
    });
  }

  async complete(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    completion: CompletionInput;
    now: Date;
  }): Promise<CompletionResult> {
    await this.expireRunIfRequired(input.workflowRunId, input.now);
    return this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, input.workflowRunId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: input.workflowRunId },
        include: runInclude,
      });
      if (run === null) {
        throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
      }
      if (terminal(run.status)) {
        if (
          run.clientCompletionId === input.completion.clientCompletionId &&
          run.completionDigest === input.completion.digest
        ) {
          return { run: toRecord(run), idempotent: true };
        }
        if (
          run.status === WorkflowRunStatus.TIMED_OUT &&
          run.terminationCause === 'approval_expired' &&
          run.clientCompletionId === null
        ) {
          const expiredResult = WorkflowExecutionResultSchema.safeParse(
            input.completion.result,
          );
          const stepsMatch =
            expiredResult.success &&
            expiredResult.data.executionId === run.id &&
            expiredResult.data.status === 'timed_out' &&
            expiredResult.data.terminationCause === 'approval_expired' &&
            expiredResult.data.steps.length === run.steps.length &&
            expiredResult.data.steps.every(
              (step, index) =>
                step.stepId === run.steps[index]?.sourceStepId &&
                step.stepType === run.steps[index]?.stepType,
            );
          if (!stepsMatch) {
            throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
          }
          const updated = await transaction.workflowRun.update({
            where: { id: run.id },
            data: {
              clientCompletionId: input.completion.clientCompletionId,
              completionDigest: input.completion.digest,
              finalResult: input.completion.result as Prisma.InputJsonValue,
            },
            include: runInclude,
          });
          return { run: toRecord(updated), idempotent: false };
        }
        throw new WorkflowRunRepositoryError('COMPLETION_CONFLICT');
      }
      this.requireLease(run, input, input.now);
      const result = WorkflowExecutionResultSchema.parse(
        input.completion.result,
      );
      if (
        result.executionId !== run.id ||
        result.steps.length !== run.steps.length
      ) {
        throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
      }
      result.steps.forEach((step, index) => {
        const source = run.steps[index];
        if (
          source === undefined ||
          source.sourceStepId !== step.stepId ||
          source.stepType !== step.stepType
        ) {
          throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
        }
        if (source.attempts.length > 0) {
          const attempts = step.attempts ?? [];
          if (
            attempts.length !== source.attempts.length ||
            attempts.some((attempt, attemptIndex) => {
              const persisted = source.attempts[attemptIndex];
              return (
                persisted === undefined ||
                persisted.attemptNumber !== attempt.attemptNumber ||
                persistedAttemptTrigger(attempt.trigger) !==
                  persisted.trigger ||
                persistedAttemptStatus(attempt.status) !== persisted.status ||
                persistedEffectCertainty(attempt.effectCertainty) !==
                  persisted.effectCertainty ||
                (attempt.errorCode ?? null) !== persisted.safeErrorCode ||
                (attempt.repairRequestId ?? null) !==
                  persisted.authorizedByRepairRequestId
              );
            })
          ) {
            throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
          }
        }
      });
      for (const approval of run.approvalRequests) {
        const approvalStep = result.steps.find(
          (step) => step.stepId === approval.approvalStepId,
        );
        const gatedStep = result.steps.find(
          (step) => step.stepId === approval.gatedStepId,
        );
        const valid =
          approvalStep !== undefined &&
          gatedStep !== undefined &&
          (approval.status === WorkflowApprovalRequestStatus.APPROVED
            ? approvalStep.status === 'succeeded'
            : approval.status === WorkflowApprovalRequestStatus.REJECTED
              ? result.terminationCause === 'approval_rejected' &&
                approvalStep.status === 'cancelled' &&
                gatedStep.status === 'skipped'
              : approval.status === WorkflowApprovalRequestStatus.EXPIRED
                ? result.terminationCause === 'approval_expired' &&
                  approvalStep.status === 'timed_out' &&
                  gatedStep.status === 'skipped'
                : approval.status === WorkflowApprovalRequestStatus.CANCELLED
                  ? result.status === 'cancelled' &&
                    gatedStep.status === 'skipped'
                  : approval.status ===
                      WorkflowApprovalRequestStatus.INVALIDATED
                    ? result.status === 'interrupted' &&
                      gatedStep.status === 'skipped'
                    : false);
        if (!valid) {
          throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
        }
      }
      if (result.outputs.length !== run.outputs.length) {
        throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
      }
      result.outputs.forEach((output, index) => {
        const source = run.outputs[index];
        const expectedType =
          source?.outputType === WorkflowRunOutputType.STRING
            ? 'string'
            : 'boolean';
        if (
          source === undefined ||
          source.outputName !== output.outputName ||
          source.producerStepId !== output.producerStepId ||
          expectedType !== output.outputType ||
          (source.status === WorkflowRunOutputStatus.PRODUCED &&
            output.status !== 'produced')
        ) {
          throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
        }
        const producerStep = result.steps[source.producerStepIndex];
        if (
          producerStep?.stepId !== source.producerStepId ||
          (output.status === 'produced') !==
            (producerStep.status === 'succeeded')
        ) {
          throw new WorkflowRunRepositoryError('COMPLETION_INVALID');
        }
      });
      for (const [index, step] of result.steps.entries()) {
        const source = run.steps[index]!;
        await transaction.workflowRunStep.update({
          where: { id: source.id },
          data: {
            status: persistedStepStatus(step.status),
            lastEngineStatus: step.status,
            startedAt:
              step.startedAt === undefined ? null : new Date(step.startedAt),
            finishedAt: new Date(step.finishedAt),
            durationMs: step.durationMs,
            errorCode: step.error?.code ?? null,
            skippedReason: step.skippedReason ?? null,
          },
        });
        const verification = step.verification;
        if (verification !== undefined) {
          await appendAuditEventTransactional(
            transaction,
            this.auditTrail,
            buildVerificationCompletedInput({
              workspaceId: run.workspaceId,
              actor: {
                type: 'runner',
                runnerDeviceId: input.runnerDeviceId,
              },
              runId: run.id,
              stepId: step.stepId,
              stepIndex: source.sourceStepIndex,
              verificationSequence: 1,
              verificationKind: verification.kind,
              outcome: verification.outcome === 'matched' ? 'passed' : 'failed',
              attemptCount: verification.attemptCount,
              occurredAt: new Date(step.finishedAt),
            }),
          );
        }
      }
      for (const [index, output] of result.outputs.entries()) {
        const source = run.outputs[index]!;
        await transaction.workflowRunOutput.update({
          where: { id: source.id },
          data: {
            status:
              output.status === 'produced'
                ? WorkflowRunOutputStatus.PRODUCED
                : WorkflowRunOutputStatus.NOT_PRODUCED,
            producedAt:
              output.status === 'produced'
                ? (source.producedAt ?? new Date(result.finishedAt))
                : null,
          },
        });
      }
      const updated = await transaction.workflowRun.update({
        where: { id: run.id },
        data: {
          status: persistedRunStatus(result.status),
          startedAt: new Date(result.startedAt),
          finishedAt: new Date(result.finishedAt),
          terminationCause: result.terminationCause,
          clientCompletionId: input.completion.clientCompletionId,
          completionDigest: input.completion.digest,
          finalResult: result as Prisma.InputJsonValue,
          leaseTokenHash: null,
          leaseExpiresAt: null,
        },
        include: runInclude,
      });
      const engineResultDigest = createCanonicalJsonDigest(
        WorkflowExecutionResultSchema.parse(input.completion.result),
      );
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildRunTerminalInput({
          workspaceId: run.workspaceId,
          actor: {
            type: 'runner',
            runnerDeviceId: input.runnerDeviceId,
          },
          runId: run.id,
          terminalStatus: result.status,
          ...(result.terminationCause === undefined
            ? {}
            : { terminationCause: result.terminationCause }),
          finishedAt: new Date(result.finishedAt),
          engineResultDigest,
          durationMs: Math.max(
            0,
            new Date(result.finishedAt).getTime() -
              new Date(result.startedAt).getTime(),
          ),
          stepCount: run.steps.length,
          producedOutputCount: result.outputs.filter(
            (output) => output.status === 'produced',
          ).length,
        }),
      );
      if (
        result.status === 'failed' ||
        result.status === 'timed_out' ||
        result.status === 'interrupted'
      ) {
        const type =
          result.status === 'failed'
            ? 'run_failed'
            : result.status === 'timed_out'
              ? 'run_timed_out'
              : 'run_interrupted';
        const terminalAt = new Date(result.finishedAt).toISOString();
        const template =
          result.status === 'failed'
            ? {
                schemaVersion: 1 as const,
                templateKey: 'run_failed.v1' as const,
                workflowRunId: run.id,
                failedAt: terminalAt,
              }
            : result.status === 'timed_out'
              ? {
                  schemaVersion: 1 as const,
                  templateKey: 'run_timed_out.v1' as const,
                  workflowRunId: run.id,
                  timedOutAt: terminalAt,
                }
              : {
                  schemaVersion: 1 as const,
                  templateKey: 'run_interrupted.v1' as const,
                  workflowRunId: run.id,
                  interruptedAt: terminalAt,
                };
        await this.operationalAlerts?.append(transaction, {
          schemaVersion: 1,
          workspaceId: run.workspaceId,
          type,
          source: { type: 'workflow_run', id: run.id },
          primaryEntity: { type: 'workflow_run', id: run.id },
          relatedEntities: [],
          template,
          actionTarget: {
            schemaVersion: 1,
            kind: 'run',
            workspaceId: run.workspaceId,
            workflowRunId: run.id,
          },
          creatorUserId: run.createdByUserId,
        });
      }
      return { run: toRecord(updated), idempotent: false };
    });
  }

  cancel(
    actorUserId: string,
    workflowRunId: string,
    now: Date,
  ): Promise<CompletionResult> {
    return this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, workflowRunId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: workflowRunId },
        include: {
          ...runInclude,
          workspace: {
            select: {
              organization: {
                select: {
                  members: {
                    where: { userId: actorUserId },
                    select: { role: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });
      const role = run?.workspace.organization.members[0]?.role;
      if (run === null || run === undefined || role === undefined) {
        throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
      }
      if (!WRITER_ROLES.includes(role as (typeof WRITER_ROLES)[number])) {
        throw new WorkflowRunRepositoryError('RUN_FORBIDDEN');
      }
      if (terminal(run.status)) {
        return { run: toRecord(run), idempotent: true };
      }
      const cancelledApprovals =
        await transaction.workflowApprovalRequest.findMany({
          where: {
            workflowRunId,
            status: WorkflowApprovalRequestStatus.PENDING,
          },
          select: {
            id: true,
            workflowRunId: true,
            workflowRun: { select: { workspaceId: true } },
          },
        });
      await transaction.workflowApprovalRequest.updateMany({
        where: {
          workflowRunId,
          status: WorkflowApprovalRequestStatus.PENDING,
        },
        data: {
          status: WorkflowApprovalRequestStatus.CANCELLED,
          resolvedAt: now,
        },
      });
      for (const approval of cancelledApprovals) {
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildApprovalLifecycleInput({
            workspaceId: approval.workflowRun.workspaceId,
            actor: { type: 'system', reason: 'automatic_expiry' },
            approvalRequestId: approval.id,
            workflowRunId: approval.workflowRunId,
            reason: 'cancelled',
            resolvedAt: now,
          }),
        );
        await this.operationalAlerts?.resolve(transaction, {
          workspaceId: approval.workflowRun.workspaceId,
          type: 'approval_required',
          sourceType: 'approval_request',
          sourceId: approval.id,
          reason: 'cancelled',
        });
      }
      const cancelledRepairs = await transaction.workflowRepairRequest.findMany(
        {
          where: {
            workflowRunId,
            status: WorkflowRepairRequestStatus.PENDING,
          },
          select: { id: true, workflowRunId: true, workspaceId: true },
        },
      );
      await transaction.workflowRepairRequest.updateMany({
        where: {
          workflowRunId,
          status: WorkflowRepairRequestStatus.PENDING,
        },
        data: {
          status: WorkflowRepairRequestStatus.CANCELLED,
          resolvedAt: now,
        },
      });
      for (const repair of cancelledRepairs) {
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildRepairLifecycleInput({
            workspaceId: repair.workspaceId,
            actor: { type: 'system', reason: 'automatic_expiry' },
            repairRequestId: repair.id,
            workflowRunId: repair.workflowRunId,
            reason: 'cancelled',
            resolvedAt: now,
          }),
        );
        await this.operationalAlerts?.resolve(transaction, {
          workspaceId: repair.workspaceId,
          type: 'repair_required',
          sourceType: 'repair_request',
          sourceId: repair.id,
          reason: 'cancelled',
        });
      }
      if (run.status === WorkflowRunStatus.QUEUED) {
        await transaction.workflowRunStep.updateMany({
          where: { workflowRunId, status: WorkflowRunStepStatus.PENDING },
          data: {
            status: WorkflowRunStepStatus.SKIPPED,
            skippedReason: 'run_cancelled',
            finishedAt: now,
          },
        });
        const cancelled = await transaction.workflowRun.update({
          where: { id: workflowRunId },
          data: {
            status: WorkflowRunStatus.CANCELLED,
            cancelRequestedAt: now,
            cancelRequestedByUserId: actorUserId,
            finishedAt: now,
            terminationCause: 'run_cancelled',
          },
          include: runInclude,
        });
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildRunTerminalInput({
            workspaceId: cancelled.workspaceId,
            actor: { type: 'user', userId: actorUserId },
            runId: cancelled.id,
            terminalStatus: 'cancelled',
            terminationCause: 'run_cancelled',
            finishedAt: now,
            stepCount: cancelled.steps.length,
            producedOutputCount: cancelled.outputs.filter(
              (output) => output.status === WorkflowRunOutputStatus.PRODUCED,
            ).length,
          }),
        );
        return { run: toRecord(cancelled), idempotent: false };
      }
      const alreadyRequested =
        run.status === WorkflowRunStatus.CANCEL_REQUESTED;
      const updated = await transaction.workflowRun.update({
        where: { id: workflowRunId },
        data: {
          status: WorkflowRunStatus.CANCEL_REQUESTED,
          cancelRequestedAt: run.cancelRequestedAt ?? now,
          cancelRequestedByUserId: run.cancelRequestedByUserId ?? actorUserId,
        },
        include: runInclude,
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildRunCancelRequestedInput({
          workspaceId: updated.workspaceId,
          actor: { type: 'user', userId: actorUserId },
          runId: updated.id,
          requestedAt: updated.cancelRequestedAt ?? now,
        }),
      );
      return { run: toRecord(updated), idempotent: alreadyRequested };
    });
  }

  async getRun(
    actorUserId: string,
    workflowRunId: string,
    now: Date,
  ): Promise<{ access: WorkflowRunAccess; run: WorkflowRunRecord } | null> {
    await this.expireRunIfRequired(workflowRunId, now);
    const access = await this.resolveWorkflowRunAccess(
      actorUserId,
      workflowRunId,
    );
    if (access === null) {
      return null;
    }
    const row = await this.prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      include: runInclude,
    });
    return row === null ? null : { access, run: toRecord(row) };
  }

  async listRuns(
    actorUserId: string,
    workspaceId: string,
    now: Date,
  ): Promise<WorkflowRunListRecord | null> {
    const access = await this.resolveWorkspaceAccess(
      this.prisma,
      actorUserId,
      workspaceId,
    );
    if (access === null) {
      return null;
    }
    const expired = await this.prisma.workflowRun.findMany({
      where: {
        workspaceId,
        status: { in: [...ACTIVE_STATUSES] },
        leaseExpiresAt: { lte: now },
      },
      select: { id: true },
    });
    for (const run of expired) {
      await this.expireRunIfRequired(run.id, now);
    }
    const rows = await this.prisma.workflowRun.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      include: runInclude,
    });
    return { workspaceId, access, runs: rows.map(toRecord) };
  }

  private claimedRecord(
    row: {
      id: string;
      leaseExpiresAt: Date | null;
      runProtocolVersion: number;
      definitionDigest: string;
      allowedOrigins: Prisma.JsonValue;
      executionOptions: Prisma.JsonValue;
      workflowVersion: { definition: Prisma.JsonValue };
      policyVersion: {
        id: string;
        revision: number;
        definition: Prisma.JsonValue;
        digest: string;
      } | null;
      policyDigest: string | null;
      policyEvaluation: Prisma.JsonValue | null;
      secretResolutionMode?: string | null;
      secretVaultId?: string | null;
      secretInventoryRevision?: number | null;
      secretInventoryDigest?: string | null;
      inputEnvelope: {
        schemaVersion: number;
        profile: string;
        contentEncryption: string;
        keyEncryption: string;
        preparationId: string;
        workflowRunId: string;
        keyId: string;
        expiresAt: Date;
        aad: string;
        iv: string;
        wrappedKey: string;
        ciphertext: string;
        ciphertextDigest: string;
        preparation: {
          variableManifest: Prisma.JsonValue;
          secretManifest: Prisma.JsonValue;
          aad: Prisma.JsonValue;
        };
      } | null;
    },
    idempotent: boolean,
  ): ClaimWorkflowRunResult {
    if (row.leaseExpiresAt === null) {
      throw new WorkflowRunRepositoryError('RUN_CONFLICT');
    }
    if (row.policyVersion === null || row.policyDigest === null) {
      throw new WorkflowRunRepositoryError('RUN_CONFLICT');
    }
    const workflow = WorkflowDefinitionSchema.parse(
      row.workflowVersion.definition,
    );
    return {
      status: 'claimed',
      runId: row.id,
      runProtocolVersion: row.runProtocolVersion,
      workflowSchemaVersion: workflow.schemaVersion,
      workflow,
      definitionDigest: row.definitionDigest,
      policy: {
        versionId: row.policyVersion.id,
        revision: row.policyVersion.revision,
        digest: row.policyDigest,
        definition: WorkspaceExecutionPolicyDefinitionSchema.parse(
          row.policyVersion.definition,
        ),
        evaluation: WorkflowPolicyEvaluationSchema.parse(row.policyEvaluation),
      },
      allowedOrigins: parseJsonArray(row.allowedOrigins),
      options: parseOptions(row.executionOptions),
      runtimeInput:
        row.secretResolutionMode === 'LOCAL_STORE' &&
        row.secretVaultId !== null &&
        row.secretVaultId !== undefined &&
        row.secretInventoryRevision !== null &&
        row.secretInventoryRevision !== undefined &&
        row.secretInventoryDigest !== null &&
        row.secretInventoryDigest !== undefined
          ? {
              kind: 'local_secret_store',
              inventory: {
                schemaVersion: 1,
                vaultId: row.secretVaultId,
                vaultRevision: row.secretInventoryRevision,
                inventoryDigest: row.secretInventoryDigest,
              },
              secrets: analyzeWorkflowInputs(workflow).secretRequirements.map(
                (requirement) => ({
                  secretName: requirement.secretName,
                  usageCount: requirement.usageCount,
                }),
              ),
            }
          : row.inputEnvelope === null
            ? { kind: 'none' }
            : {
                kind: 'encrypted_envelope',
                envelope: SecureRunInputEnvelopeSchema.parse({
                  schemaVersion: row.inputEnvelope.schemaVersion,
                  profile: row.inputEnvelope.profile,
                  contentEncryption: row.inputEnvelope.contentEncryption,
                  keyEncryption: row.inputEnvelope.keyEncryption,
                  preparationId: row.inputEnvelope.preparationId,
                  workflowRunId: row.inputEnvelope.workflowRunId,
                  keyId: row.inputEnvelope.keyId,
                  expiresAt: row.inputEnvelope.expiresAt.toISOString(),
                  aad: row.inputEnvelope.aad,
                  iv: row.inputEnvelope.iv,
                  wrappedKey: row.inputEnvelope.wrappedKey,
                  ciphertext: row.inputEnvelope.ciphertext,
                  ciphertextDigest: row.inputEnvelope.ciphertextDigest,
                }),
                aad: RunInputAdditionalAuthenticatedDataSchema.parse(
                  row.inputEnvelope.preparation.aad,
                ),
                manifest: SecureRunInputManifestSchema.parse({
                  schemaVersion: 1,
                  variables: row.inputEnvelope.preparation.variableManifest,
                  secrets: row.inputEnvelope.preparation.secretManifest,
                }),
              },
      leaseExpiresAt: row.leaseExpiresAt,
      idempotent,
    };
  }

  private requireLease(
    run: {
      runnerDeviceId: string;
      status: WorkflowRunStatus;
      leaseTokenHash: string | null;
      leaseExpiresAt: Date | null;
      runnerDevice?: {
        revokedAt: Date | null;
        credential: { revokedAt: Date | null } | null;
      };
    } | null,
    input: { runnerDeviceId: string; leaseTokenHash: string },
    now: Date,
  ): void {
    if (run === null) {
      throw new WorkflowRunRepositoryError('RUN_NOT_FOUND');
    }
    if (run.runnerDeviceId !== input.runnerDeviceId) {
      throw new WorkflowRunRepositoryError('RUNNER_MISMATCH');
    }
    if (
      run.runnerDevice?.revokedAt !== null &&
      run.runnerDevice?.revokedAt !== undefined
    ) {
      throw new WorkflowRunRepositoryError('RUNNER_REVOKED');
    }
    if (
      run.runnerDevice?.credential?.revokedAt !== null &&
      run.runnerDevice?.credential?.revokedAt !== undefined
    ) {
      throw new WorkflowRunRepositoryError('RUNNER_REVOKED');
    }
    if (
      !ACTIVE_STATUSES.includes(
        run.status as (typeof ACTIVE_STATUSES)[number],
      ) ||
      run.leaseTokenHash !== input.leaseTokenHash ||
      run.leaseExpiresAt === null
    ) {
      throw new WorkflowRunRepositoryError('LEASE_INVALID');
    }
    if (run.leaseExpiresAt.getTime() <= now.getTime()) {
      throw new WorkflowRunRepositoryError('LEASE_EXPIRED');
    }
  }

  private validEngineRunTransition(
    current: string | null,
    next: WorkflowEngineRunStatus,
  ): boolean {
    if (current === null) {
      return next === 'pending';
    }
    const parsed = current as WorkflowEngineRunStatus;
    return (
      validRunTransitions()[parsed] as readonly WorkflowEngineRunStatus[]
    ).includes(next);
  }

  private validEngineStepTransition(
    current: string | null,
    next: WorkflowEngineStepStatus,
  ): boolean {
    if (current === null) {
      return next === 'pending';
    }
    const parsed = current as WorkflowEngineStepStatus;
    return (
      validStepTransitions()[parsed] as readonly WorkflowEngineStepStatus[]
    ).includes(next);
  }

  private async expireRunIfRequired(runId: string, now: Date): Promise<void> {
    await this.runSerializable(async (transaction) => {
      await this.lockRun(transaction, runId);
      const run = await transaction.workflowRun.findUnique({
        where: { id: runId },
        select: { status: true, leaseExpiresAt: true },
      });
      if (
        run !== null &&
        ACTIVE_STATUSES.includes(
          run.status as (typeof ACTIVE_STATUSES)[number],
        ) &&
        run.leaseExpiresAt !== null &&
        run.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        await this.interruptLockedRun(transaction, runId, now);
      }
    });
  }

  private async interruptLockedRun(
    transaction: Prisma.TransactionClient,
    runId: string,
    now: Date,
  ): Promise<void> {
    await transaction.workflowRunStep.updateMany({
      where: {
        workflowRunId: runId,
        status: {
          in: [
            WorkflowRunStepStatus.RUNNING,
            WorkflowRunStepStatus.WAITING_FOR_APPROVAL,
            WorkflowRunStepStatus.WAITING_FOR_REPAIR,
          ],
        },
      },
      data: {
        status: WorkflowRunStepStatus.INTERRUPTED,
        errorCode: 'LEASE_EXPIRED',
        finishedAt: now,
      },
    });
    const invalidatedApprovals =
      await transaction.workflowApprovalRequest.findMany({
        where: {
          workflowRunId: runId,
          status: WorkflowApprovalRequestStatus.PENDING,
        },
        select: {
          id: true,
          workflowRunId: true,
          workflowRun: { select: { workspaceId: true } },
        },
      });
    await transaction.workflowApprovalRequest.updateMany({
      where: {
        workflowRunId: runId,
        status: WorkflowApprovalRequestStatus.PENDING,
      },
      data: {
        status: WorkflowApprovalRequestStatus.INVALIDATED,
        resolvedAt: now,
      },
    });
    for (const approval of invalidatedApprovals) {
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildApprovalLifecycleInput({
          workspaceId: approval.workflowRun.workspaceId,
          actor: { type: 'system', reason: 'automatic_expiry' },
          approvalRequestId: approval.id,
          workflowRunId: approval.workflowRunId,
          reason: 'invalidated',
          resolvedAt: now,
        }),
      );
      await this.operationalAlerts?.resolve(transaction, {
        workspaceId: approval.workflowRun.workspaceId,
        type: 'approval_required',
        sourceType: 'approval_request',
        sourceId: approval.id,
        reason: 'invalidated',
      });
    }
    const invalidatedRepairs = await transaction.workflowRepairRequest.findMany(
      {
        where: {
          workflowRunId: runId,
          status: WorkflowRepairRequestStatus.PENDING,
        },
        select: { id: true, workflowRunId: true, workspaceId: true },
      },
    );
    await transaction.workflowRepairRequest.updateMany({
      where: {
        workflowRunId: runId,
        status: WorkflowRepairRequestStatus.PENDING,
      },
      data: {
        status: WorkflowRepairRequestStatus.INVALIDATED,
        resolvedAt: now,
      },
    });
    for (const repair of invalidatedRepairs) {
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildRepairLifecycleInput({
          workspaceId: repair.workspaceId,
          actor: { type: 'system', reason: 'automatic_expiry' },
          repairRequestId: repair.id,
          workflowRunId: repair.workflowRunId,
          reason: 'invalidated',
          resolvedAt: now,
        }),
      );
      await this.operationalAlerts?.resolve(transaction, {
        workspaceId: repair.workspaceId,
        type: 'repair_required',
        sourceType: 'repair_request',
        sourceId: repair.id,
        reason: 'invalidated',
      });
    }
    await transaction.workflowRunStepAttempt.updateMany({
      where: {
        workflowRunId: runId,
        status: WorkflowRunStepAttemptStatus.RUNNING,
      },
      data: {
        status: WorkflowRunStepAttemptStatus.INTERRUPTED,
        safeErrorCode: 'LEASE_EXPIRED',
        effectCertainty: WorkflowExecutionEffectCertainty.UNKNOWN,
        finishedAt: now,
      },
    });
    await transaction.workflowRunStep.updateMany({
      where: { workflowRunId: runId, status: WorkflowRunStepStatus.PENDING },
      data: {
        status: WorkflowRunStepStatus.SKIPPED,
        skippedReason: 'run_interrupted',
        finishedAt: now,
      },
    });
    const updatedRun = await transaction.workflowRun.update({
      where: { id: runId },
      data: {
        status: WorkflowRunStatus.INTERRUPTED,
        terminationCause: 'lease_expired',
        finishedAt: now,
        leaseTokenHash: null,
        leaseExpiresAt: null,
      },
      include: {
        steps: { select: { id: true } },
        outputs: { select: { status: true } },
      },
    });
    await appendAuditEventTransactional(
      transaction,
      this.auditTrail,
      buildRunInterruptedInput({
        workspaceId: updatedRun.workspaceId,
        runId: updatedRun.id,
        finishedAt: now,
        stepCount: updatedRun.steps.length,
        producedOutputCount: updatedRun.outputs.filter(
          (output) => output.status === WorkflowRunOutputStatus.PRODUCED,
        ).length,
      }),
    );
    await this.operationalAlerts?.append(transaction, {
      schemaVersion: 1,
      workspaceId: updatedRun.workspaceId,
      type: 'run_interrupted',
      source: { type: 'workflow_run', id: updatedRun.id },
      primaryEntity: { type: 'workflow_run', id: updatedRun.id },
      relatedEntities: [],
      template: {
        schemaVersion: 1,
        templateKey: 'run_interrupted.v1',
        workflowRunId: updatedRun.id,
        interruptedAt: now.toISOString(),
      },
      actionTarget: {
        schemaVersion: 1,
        kind: 'run',
        workspaceId: updatedRun.workspaceId,
        workflowRunId: updatedRun.id,
      },
      creatorUserId: updatedRun.createdByUserId,
    });
  }

  private async lockRun(
    transaction: Prisma.TransactionClient,
    runId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id" FROM "workflow_runs" WHERE "id" = ${runId}::uuid FOR UPDATE
    `;
  }

  private async resolveWorkspaceAccess(
    client: Prisma.TransactionClient | PrismaClient,
    userId: string,
    workspaceId: string,
  ): Promise<WorkflowRunAccess | null> {
    const membership = await client.organizationMember.findFirst({
      where: {
        userId,
        organization: { workspaces: { some: { id: workspaceId } } },
      },
      select: { organizationId: true, role: true },
    });
    return membership === null
      ? null
      : {
          organizationId: membership.organizationId,
          userId,
          role: membership.role,
        };
  }

  private async runSerializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 0; attempt < SERIALIZATION_RETRY_COUNT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (
          !isSerializationError(error) ||
          attempt === SERIALIZATION_RETRY_COUNT - 1
        ) {
          if (isSerializationError(error)) {
            throw new WorkflowRunRepositoryError('SERIALIZATION_FAILURE');
          }
          throw error;
        }
      }
    }
    throw new WorkflowRunRepositoryError('SERIALIZATION_FAILURE');
  }
}
