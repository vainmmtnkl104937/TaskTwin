import { randomUUID } from 'node:crypto';

import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import {
  WorkspaceExecutionPolicyDefinitionSchema,
  evaluateWorkflowPolicy,
} from '@tasktwin/workflow-policy';
import { RUN_PROTOCOL_VERSION } from '@tasktwin/run-protocol';
import {
  OrganizationRole,
  Prisma,
  WorkflowRunStatus,
  type PrismaClient,
} from '../generated/prisma/client.js';
import {
  WorkflowScheduleStatus,
  WorkflowScheduleOccurrenceStatus,
} from './prisma-types.js';
import {
  appendAuditEventTransactional,
  auditHasherForTrail,
} from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { WorkflowScheduleRepositoryError } from './workflow-schedule-errors.js';
import type {
  WorkflowScheduleAccess,
  WorkflowScheduleRecord,
  WorkflowScheduleOccurrenceRecord,
  ScheduleCreationResult,
  OccurrenceDispatchResult,
} from './workflow-schedule-records.js';
import type { OperationalAlertTransactionAppender } from '../operational-alerts/operational-alert-port.js';
import {
  nextOccurrence,
  ScheduleDefinitionSchema,
  analyzeScheduleCreationReadiness,
} from '@tasktwin/workflow-scheduling';
import {
  createAuditSourceId,
  type AuditEventInput,
} from '@tasktwin/audit-trail';
import { analyzeWorkflowInputs } from '@tasktwin/workflow-inputs';
import {
  canRunnerClaimJobs,
  evaluatePersistedRunnerCompatibility,
} from '../runner/runner-software-compatibility.js';

const SERIALIZATION_RETRY_COUNT = 3;
const SCHEDULED_EXECUTION_CAPABILITY = 'scheduled_execution_v1';
const LOCAL_SECRET_STORE_CAPABILITY = 'local_secret_store_v1';
const TRIGGER_SCHEDULED = 'scheduled';
const RUNNER_UPDATE_MAINTENANCE_FRESHNESS_MS = 20 * 60_000;

const SCHEDULE_EVENT_NAMESPACES = {
  created: 'schedule_created',
  paused: 'schedule_paused',
  resumed: 'schedule_resumed',
  archived: 'schedule_archived',
  autoPaused: 'schedule_auto_paused',
  occurrenceDispatched: 'schedule_occurrence_dispatched',
  occurrenceSkipped: 'schedule_occurrence_skipped',
  occurrenceStartWindowExpired: 'schedule_occurrence_start_window_expired',
  occurrenceSucceeded: 'schedule_occurrence_succeeded',
} as const;

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

function buildScheduleCreatedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  scheduleId: string;
  scheduleName: string;
  workflowId: string;
  workflowVersionId: string;
  workflowDigest: string;
  clientScheduleId: string;
  runnerDeviceId: string;
  scheduleType: 'one_time' | 'daily' | 'weekly';
  timezone: string;
  policyVersionId: string;
  policyDigest: string;
  nextOccurrenceAt: Date | null;
  maxStartDelaySeconds: number;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.created',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_schedule', id: input.scheduleId },
    relatedEntities: [
      { kind: 'workflow', id: input.workflowId },
      { kind: 'workflow_version', id: input.workflowVersionId },
      { kind: 'policy_version', id: input.policyVersionId },
    ],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.created,
      [input.scheduleId, input.clientScheduleId],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      runnerDeviceId: input.runnerDeviceId,
      scheduleName: input.scheduleName,
      scheduleType: input.scheduleType,
      timezone: input.timezone,
      scheduleDigest: input.workflowDigest,
      workflowDigest: input.workflowDigest,
      policyVersionId: input.policyVersionId,
      policyDigest: input.policyDigest,
      nextOccurrenceAt: input.nextOccurrenceAt,
      maxStartDelaySeconds: input.maxStartDelaySeconds,
    },
  };
}

function buildSchedulePausedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  scheduleId: string;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.paused',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_schedule', id: input.scheduleId },
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.paused,
      [input.scheduleId, input.occurredAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      pausedAt: input.occurredAt,
    },
  };
}

function buildScheduleResumedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  scheduleId: string;
  nextOccurrenceAt: Date | null;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.resumed',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_schedule', id: input.scheduleId },
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.resumed,
      [input.scheduleId, input.occurredAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      resumedAt: input.occurredAt,
      nextOccurrenceAt: input.nextOccurrenceAt ?? new Date(0),
    },
  };
}

function buildScheduleArchivedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  scheduleId: string;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.archived',
    actor: input.actor,
    primaryEntity: { kind: 'workflow_schedule', id: input.scheduleId },
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.archived,
      [input.scheduleId, input.occurredAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      archivedAt: input.occurredAt,
    },
  };
}

function buildScheduleAutoPausedInput(input: {
  workspaceId: string;
  scheduleId: string;
  occurrenceId: string;
  reason:
    | 'policy_review_required'
    | 'source_version_unavailable'
    | 'ambiguous_outcome'
    | 'secret_readiness_failed'
    | 'runner_update_required';
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.auto_paused',
    actor: { type: 'system', reason: 'automatic' },
    primaryEntity: { kind: 'workflow_schedule', id: input.scheduleId },
    relatedEntities: [
      { kind: 'workflow_schedule_occurrence', id: input.occurrenceId },
    ],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.autoPaused,
      [input.scheduleId, input.occurrenceId, input.reason],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      reason: input.reason,
      autoPausedAt: input.occurredAt,
      triggeringOccurrenceId: input.occurrenceId,
    },
  };
}

function buildOccurrenceDispatchedInput(input: {
  workspaceId: string;
  scheduleId: string;
  occurrenceId: string;
  workflowRunId: string;
  scheduledFor: Date;
  startDeadlineAt: Date;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.occurrence.dispatched',
    actor: { type: 'system', reason: 'scheduler' },
    primaryEntity: {
      kind: 'workflow_schedule_occurrence',
      id: input.occurrenceId,
    },
    relatedEntities: [
      { kind: 'workflow_schedule', id: input.scheduleId },
      { kind: 'workflow_run', id: input.workflowRunId },
    ],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.occurrenceDispatched,
      [input.occurrenceId, input.workflowRunId],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      occurrenceId: input.occurrenceId,
      workflowRunId: input.workflowRunId,
      scheduledFor: input.scheduledFor,
      startDeadlineAt: input.startDeadlineAt,
    },
  };
}

function buildOccurrenceSkippedInput(input: {
  workspaceId: string;
  scheduleId: string;
  occurrenceId: string;
  reason:
    | 'schedule_overlap'
    | 'runner_busy'
    | 'runner_unavailable'
    | 'runner_update_required'
    | 'runner_maintenance'
    | 'policy_denied'
    | 'source_version_unavailable'
    | 'missed_start_window'
    | 'nonexistent_local_time'
    | 'repeated_local_time'
    | 'secret_readiness_failed';
  scheduledFor: Date;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.occurrence.skipped',
    actor: { type: 'system', reason: 'scheduler' },
    primaryEntity: {
      kind: 'workflow_schedule_occurrence',
      id: input.occurrenceId,
    },
    relatedEntities: [{ kind: 'workflow_schedule', id: input.scheduleId }],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.occurrenceSkipped,
      [input.occurrenceId, input.reason],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      occurrenceId: input.occurrenceId,
      scheduledFor: input.scheduledFor,
      skipReason: input.reason,
      skippedAt: input.occurredAt,
    },
  };
}

function buildOccurrenceStartWindowExpiredInput(input: {
  workspaceId: string;
  scheduleId: string;
  occurrenceId: string;
  workflowRunId: string;
  scheduledFor: Date;
  startDeadlineAt: Date;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.occurrence.start_window_expired',
    actor: { type: 'system', reason: 'scheduler' },
    primaryEntity: {
      kind: 'workflow_schedule_occurrence',
      id: input.occurrenceId,
    },
    relatedEntities: [
      { kind: 'workflow_schedule', id: input.scheduleId },
      { kind: 'workflow_run', id: input.workflowRunId },
    ],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.occurrenceStartWindowExpired,
      [input.occurrenceId],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      occurrenceId: input.occurrenceId,
      workflowRunId: input.workflowRunId,
      scheduledFor: input.scheduledFor,
      startDeadlineAt: input.startDeadlineAt,
      expiredAt: input.occurredAt,
    },
  };
}

function buildOccurrenceSucceededInput(input: {
  workspaceId: string;
  scheduleId: string;
  occurrenceId: string;
  workflowRunId: string;
  occurredAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'schedule.occurrence.succeeded',
    actor: { type: 'system', reason: 'scheduler' },
    primaryEntity: {
      kind: 'workflow_schedule_occurrence',
      id: input.occurrenceId,
    },
    relatedEntities: [
      { kind: 'workflow_schedule', id: input.scheduleId },
      { kind: 'workflow_run', id: input.workflowRunId },
    ],
    occurredAt: input.occurredAt,
    sourceId: createAuditSourceId(
      SCHEDULE_EVENT_NAMESPACES.occurrenceSucceeded,
      [input.occurrenceId],
      auditHasherForTrail,
    ),
    payload: {
      scheduleId: input.scheduleId,
      occurrenceId: input.occurrenceId,
      workflowRunId: input.workflowRunId,
    },
  };
}

function toScheduleRecord(
  row: Record<string, unknown>,
): WorkflowScheduleRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    workflowId: row.workflowId as string,
    workflowVersionId: row.workflowVersionId as string,
    workflowVersion: (row.workflowVersion as { version: number }).version,
    runnerDeviceId: row.runnerDeviceId as string,
    createdByUserId: row.createdByUserId as string,
    clientScheduleId: row.clientScheduleId as string,
    name: row.name as string,
    definition: row.definition,
    definitionDigest: row.definitionDigest as string,
    workflowDigest: row.workflowDigest as string,
    status: row.status as WorkflowScheduleRecord['status'],
    overlapPolicy: row.overlapPolicy as string,
    misfirePolicy: row.misfirePolicy as string,
    maxStartDelaySeconds: row.maxStartDelaySeconds as number,
    nextOccurrenceAt: row.nextOccurrenceAt as Date | null,
    lastOccurrenceAt: row.lastOccurrenceAt as Date | null,
    autoPauseReason: row.autoPauseReason as string | null,
    autoPausedAt: row.autoPausedAt as Date | null,
    autoPausedByOccurrenceId: row.autoPausedByOccurrenceId as string | null,
    completedAt: row.completedAt as Date | null,
    archivedAt: row.archivedAt as Date | null,
    archivedByUserId: row.archivedByUserId as string | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function toOccurrenceRecord(
  row: Record<string, unknown>,
): WorkflowScheduleOccurrenceRecord {
  return {
    id: row.id as string,
    scheduleId: row.scheduleId as string,
    workflowRunId: row.workflowRunId as string | null,
    scheduledFor: row.scheduledFor as Date,
    startDeadlineAt: row.startDeadlineAt as Date,
    status: row.status as WorkflowScheduleOccurrenceRecord['status'],
    skipReason: row.skipReason as string | null,
    skippedAt: row.skippedAt as Date | null,
    dispatchedAt: row.dispatchedAt as Date | null,
    completedAt: row.completedAt as Date | null,
    terminationCause: row.terminationCause as string | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function isOccurrenceSkipped(result: {
  scheduledInstant?: Date;
  reason?: string;
}): result is { reason: string } {
  return 'reason' in result;
}

function getScheduleType(definition: unknown): 'one_time' | 'daily' | 'weekly' {
  if (typeof definition !== 'object' || definition === null) {
    return 'daily';
  }
  const def = definition as Record<string, unknown>;
  const type = def.type;
  if (type === 'one_time' || type === 'daily' || type === 'weekly') {
    return type;
  }
  return 'daily';
}

function getTimezone(definition: unknown): string {
  if (typeof definition !== 'object' || definition === null) {
    return 'UTC';
  }
  const def = definition as Record<string, unknown>;
  if (typeof def.timezone === 'string') {
    return def.timezone;
  }
  return 'UTC';
}

export class WorkflowScheduleRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditTrail: WorkspaceAuditTrailRepository = new WorkspaceAuditTrailRepository(
      prisma,
    ),
    private readonly operationalAlerts?: OperationalAlertTransactionAppender,
  ) {}

  async create(input: {
    actorUserId: string;
    workflowVersionId: string;
    runnerDeviceId: string;
    clientScheduleId: string;
    name: string;
    definition: unknown;
    maxStartDelaySeconds: number;
    now: Date;
  }): Promise<ScheduleCreationResult> {
    return this.runSerializable(async (transaction) => {
      const parsedDefinition = ScheduleDefinitionSchema.safeParse(
        input.definition,
      );
      if (!parsedDefinition.success) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY', {
          code: 'SCHEDULE_DEFINITION_INVALID',
          message: 'Invalid schedule definition',
        });
      }
      const definition = parsedDefinition.data;

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
          workflow: {
            select: { workspaceId: true, id: true },
          },
        },
      });
      if (version === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }

      const access = await this.resolveWorkspaceAccess(
        transaction,
        input.actorUserId,
        version.workflow.workspaceId,
      );
      if (
        access === null ||
        (access.role !== OrganizationRole.OWNER &&
          access.role !== OrganizationRole.ADMIN)
      ) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_FORBIDDEN');
      }

      const existing = await transaction.workflowSchedule.findUnique({
        where: {
          workspaceId_clientScheduleId: {
            workspaceId: version.workflow.workspaceId,
            clientScheduleId: input.clientScheduleId,
          },
        },
      });
      if (existing !== null) {
        const existingDefDigest = existing.definitionDigest;
        const newDefDigest = createCanonicalJsonDigest(definition);
        if (existingDefDigest !== newDefDigest) {
          throw new WorkflowScheduleRepositoryError(
            'SCHEDULE_IDEMPOTENCY_CONFLICT',
          );
        }
        const existingRecord = await transaction.workflowSchedule.findUnique({
          where: { id: existing.id },
        });
        if (existingRecord === null) {
          throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
        }
        return {
          schedule: toScheduleRecord(
            existingRecord as unknown as Record<string, unknown>,
          ),
          nextOccurrenceAt: existingRecord.nextOccurrenceAt,
          idempotent: true,
          ready: true,
          readinessIssues: [],
        };
      }

      const runner = await transaction.runnerDevice.findFirst({
        where: {
          id: input.runnerDeviceId,
          workspaceId: version.workflow.workspaceId,
        },
        select: {
          revokedAt: true,
          capabilities: true,
          secretInventory: {
            select: {
              storeStatus: true,
              vaultId: true,
              vaultRevision: true,
              inventoryDigest: true,
              entries: { select: { alias: true } },
            },
          },
        },
      });
      if (runner === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_RUNNER_MISMATCH');
      }
      if (runner.revokedAt !== null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_RUNNER_REVOKED');
      }
      if (!runner.capabilities.includes(SCHEDULED_EXECUTION_CAPABILITY)) {
        throw new WorkflowScheduleRepositoryError('RUNNER_NOT_CAPABLE');
      }

      if (version.status !== 'published' || version.schemaVersion !== 1) {
        throw new WorkflowScheduleRepositoryError(
          'SCHEDULE_VERSION_UNAVAILABLE',
        );
      }
      const workflowDefParsed = WorkflowDefinitionSchema.safeParse(
        version.definition,
      );
      if (!workflowDefParsed.success) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY');
      }
      const workflowDef = workflowDefParsed.data;

      const activePolicy =
        await transaction.workspaceExecutionPolicyVersion.findFirst({
          where: {
            workspaceId: version.workflow.workspaceId,
            status: 'ACTIVE',
          },
          select: { id: true, revision: true, digest: true, definition: true },
        });
      if (activePolicy === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY');
      }
      const parsedPolicy = WorkspaceExecutionPolicyDefinitionSchema.safeParse(
        activePolicy.definition,
      );
      if (!parsedPolicy.success) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY');
      }
      const workflowDigest = createCanonicalJsonDigest(workflowDef);
      const policyEvaluation = evaluateWorkflowPolicy({
        policy: parsedPolicy.data,
        workflow: workflowDef,
        policyDigest: activePolicy.digest,
        workflowDigest,
        localSecrets: {
          capabilityAvailable: runner.capabilities.includes(
            LOCAL_SECRET_STORE_CAPABILITY,
          ),
          status: (runner.secretInventory?.storeStatus.toLowerCase() ??
            'unavailable') as 'ready' | 'locked' | 'unavailable' | 'corrupted',
          synchronized: runner.secretInventory !== null,
          aliases:
            runner.secretInventory?.entries.map((entry) => entry.alias) ?? [],
        },
      });
      if (
        policyEvaluation.overallDecision === 'deny' ||
        policyEvaluation.hasBlockingIssues
      ) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_POLICY_DENIED', {
          evaluation: policyEvaluation,
        });
      }

      const readiness = analyzeScheduleCreationReadiness({
        workflowVersionStatus: version.status,
        workflowDefinition: version.definition,
        runnerWorkspaceId: version.workflow.workspaceId,
        targetWorkspaceId: version.workflow.workspaceId,
        runnerRevokedAt: runner.revokedAt,
        executionPolicy: activePolicy.definition,
        executionPolicyDigest: activePolicy.digest,
        workflowDigest,
      });
      if (!readiness.ready) {
        throw new WorkflowScheduleRepositoryError(
          'SCHEDULE_NOT_READY',
          readiness,
        );
      }

      const nextResult = nextOccurrence(
        definition,
        input.now,
        input.maxStartDelaySeconds,
      );
      let nextOccurrenceAt: Date | null = null;
      if (!isOccurrenceSkipped(nextResult)) {
        nextOccurrenceAt = nextResult.scheduledInstant;
      }

      const definitionDigest = createCanonicalJsonDigest(definition);
      const scheduleType = getScheduleType(definition);
      const timezone = getTimezone(definition);

      const created = await transaction.workflowSchedule.create({
        data: {
          workspaceId: version.workflow.workspaceId,
          workflowId: version.workflowId,
          workflowVersionId: version.id,
          runnerDeviceId: input.runnerDeviceId,
          createdByUserId: input.actorUserId,
          clientScheduleId: input.clientScheduleId,
          name: input.name,
          definition: definition as Prisma.InputJsonValue,
          definitionDigest,
          workflowDigest,
          status: WorkflowScheduleStatus.ACTIVE,
          overlapPolicy: 'skip',
          misfirePolicy: 'skip',
          maxStartDelaySeconds: input.maxStartDelaySeconds,
          nextOccurrenceAt,
        },
      });

      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildScheduleCreatedInput({
          workspaceId: version.workflow.workspaceId,
          actor: { type: 'user', userId: input.actorUserId },
          scheduleId: created.id,
          scheduleName: input.name,
          workflowId: version.workflowId,
          workflowVersionId: version.id,
          workflowDigest,
          clientScheduleId: input.clientScheduleId,
          runnerDeviceId: input.runnerDeviceId,
          scheduleType,
          timezone,
          policyVersionId: activePolicy.id,
          policyDigest: activePolicy.digest,
          nextOccurrenceAt,
          maxStartDelaySeconds: input.maxStartDelaySeconds,
          occurredAt: input.now,
        }),
      );

      const record = await transaction.workflowSchedule.findUnique({
        where: { id: created.id },
      });
      if (record === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      return {
        schedule: toScheduleRecord(
          record as unknown as Record<string, unknown>,
        ),
        nextOccurrenceAt,
        idempotent: false,
        ready: readiness.ready,
        readinessIssues: readiness.issues,
      };
    });
  }

  async getById(
    actorUserId: string,
    scheduleId: string,
  ): Promise<{
    access: WorkflowScheduleAccess;
    schedule: WorkflowScheduleRecord;
  } | null> {
    const row = await this.prisma.workflowSchedule.findFirst({
      where: {
        id: scheduleId,
        workspace: {
          organization: { members: { some: { userId: actorUserId } } },
        },
      },
      select: {
        id: true,
        workspaceId: true,
        workflowId: true,
        workflowVersionId: true,
        workflowVersion: { select: { version: true } },
        runnerDeviceId: true,
        createdByUserId: true,
        clientScheduleId: true,
        name: true,
        definition: true,
        definitionDigest: true,
        workflowDigest: true,
        status: true,
        overlapPolicy: true,
        misfirePolicy: true,
        maxStartDelaySeconds: true,
        nextOccurrenceAt: true,
        lastOccurrenceAt: true,
        autoPauseReason: true,
        autoPausedAt: true,
        autoPausedByOccurrenceId: true,
        completedAt: true,
        archivedAt: true,
        archivedByUserId: true,
        createdAt: true,
        updatedAt: true,
        workspace: {
          select: {
            organization: {
              select: {
                id: true,
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
    if (row === null) {
      return null;
    }
    const role = row.workspace.organization.members[0]?.role;
    if (role === undefined) {
      return null;
    }
    const { workspace: _workspace, ...scheduleData } = row;
    void _workspace;
    return {
      access: {
        workspaceId: row.workspaceId,
        organizationId: row.workspace.organization.id,
        userId: actorUserId,
        role,
      },
      schedule: toScheduleRecord(
        scheduleData as unknown as Record<string, unknown>,
      ),
    };
  }

  async listByWorkspace(
    actorUserId: string,
    workspaceId: string,
    _now: Date,
  ): Promise<{
    workspaceId: string;
    access: WorkflowScheduleAccess;
    schedules: WorkflowScheduleRecord[];
    nextCursor: string | null;
  } | null> {
    void _now;
    const access = await this.resolveWorkspaceAccess(
      this.prisma,
      actorUserId,
      workspaceId,
    );
    if (access === null) {
      return null;
    }
    const rows = await this.prisma.workflowSchedule.findMany({
      where: {
        workspaceId,
        status: { not: WorkflowScheduleStatus.ARCHIVED },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
    return {
      workspaceId,
      access,
      schedules: rows.map((row) =>
        toScheduleRecord(row as unknown as Record<string, unknown>),
      ),
      nextCursor:
        rows.length === 100 ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  async getOccurrences(
    actorUserId: string,
    scheduleId: string,
    limit: number = 50,
    beforeCursor?: string,
  ): Promise<{
    access: WorkflowScheduleAccess;
    occurrences: WorkflowScheduleOccurrenceRecord[];
    nextCursor: string | null;
  } | null> {
    const schedule = await this.prisma.workflowSchedule.findFirst({
      where: {
        id: scheduleId,
        workspace: {
          organization: { members: { some: { userId: actorUserId } } },
        },
      },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            organization: {
              select: {
                id: true,
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
    if (schedule === null) {
      return null;
    }
    const role = schedule.workspace.organization.members[0]?.role;
    if (role === undefined) {
      return null;
    }
    const access: WorkflowScheduleAccess = {
      workspaceId: schedule.workspaceId,
      organizationId: schedule.workspace.organization.id,
      userId: actorUserId,
      role,
    };

    const beforeDate = beforeCursor
      ? await this.getOccurrenceCreatedAt(beforeCursor)
      : undefined;

    const rows = await this.prisma.workflowScheduleOccurrence.findMany({
      where: {
        scheduleId,
        ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return {
      access,
      occurrences: rows.map((row) =>
        toOccurrenceRecord(row as unknown as Record<string, unknown>),
      ),
      nextCursor:
        rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  async pause(
    actorUserId: string,
    scheduleId: string,
    now: Date,
  ): Promise<WorkflowScheduleRecord> {
    return this.runSerializable(async (transaction) => {
      const schedule = await transaction.workflowSchedule.findUnique({
        where: { id: scheduleId },
        select: {
          id: true,
          workspaceId: true,
          status: true,
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
      if (schedule === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      const role = schedule.workspace.organization.members[0]?.role;
      if (
        role === undefined ||
        (role !== OrganizationRole.OWNER && role !== OrganizationRole.ADMIN)
      ) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_FORBIDDEN');
      }
      if (
        schedule.status !== WorkflowScheduleStatus.ACTIVE &&
        schedule.status !== WorkflowScheduleStatus.PAUSED
      ) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_PAUSED');
      }
      await transaction.workflowSchedule.update({
        where: { id: scheduleId },
        data: { status: WorkflowScheduleStatus.PAUSED },
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildSchedulePausedInput({
          workspaceId: schedule.workspaceId,
          actor: { type: 'user', userId: actorUserId },
          scheduleId,
          occurredAt: now,
        }),
      );
      const record = await transaction.workflowSchedule.findUnique({
        where: { id: scheduleId },
      });
      if (record === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      return toScheduleRecord(record as unknown as Record<string, unknown>);
    });
  }

  async resume(
    actorUserId: string,
    scheduleId: string,
    now: Date,
  ): Promise<WorkflowScheduleRecord> {
    return this.runSerializable(async (transaction) => {
      const schedule = await transaction.workflowSchedule.findUnique({
        where: { id: scheduleId },
        select: {
          id: true,
          workspaceId: true,
          status: true,
          autoPausedByOccurrenceId: true,
          definition: true,
          maxStartDelaySeconds: true,
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
      if (schedule === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      const role = schedule.workspace.organization.members[0]?.role;
      if (
        role === undefined ||
        (role !== OrganizationRole.OWNER && role !== OrganizationRole.ADMIN)
      ) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_FORBIDDEN');
      }
      if (
        schedule.status !== WorkflowScheduleStatus.PAUSED &&
        schedule.status !== WorkflowScheduleStatus.AUTO_PAUSED
      ) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_CANNOT_RESUME');
      }
      const parsedDef = ScheduleDefinitionSchema.safeParse(schedule.definition);
      if (!parsedDef.success) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY');
      }
      const nextResult = nextOccurrence(
        parsedDef.data,
        now,
        schedule.maxStartDelaySeconds,
      );
      let nextOccurrenceAt: Date | null = null;
      if (!isOccurrenceSkipped(nextResult)) {
        nextOccurrenceAt = nextResult.scheduledInstant;
      }
      await transaction.workflowSchedule.update({
        where: { id: scheduleId },
        data: {
          status: WorkflowScheduleStatus.ACTIVE,
          nextOccurrenceAt,
          autoPauseReason: null,
          autoPausedAt: null,
          autoPausedByOccurrenceId: null,
        },
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildScheduleResumedInput({
          workspaceId: schedule.workspaceId,
          actor: { type: 'user', userId: actorUserId },
          scheduleId,
          nextOccurrenceAt,
          occurredAt: now,
        }),
      );
      if (schedule.status === WorkflowScheduleStatus.AUTO_PAUSED) {
        await this.operationalAlerts?.resolve(transaction, {
          workspaceId: schedule.workspaceId,
          type: 'schedule_auto_paused',
          sourceType: 'workflow_schedule',
          sourceId: schedule.id,
          reason: 'resumed',
          resolvedByUserId: actorUserId,
          ignoreAlreadyResolved: true,
        });
        if (schedule.autoPausedByOccurrenceId !== null) {
          await this.operationalAlerts?.resolve(transaction, {
            workspaceId: schedule.workspaceId,
            type: 'schedule_auto_paused',
            sourceType: 'workflow_schedule_occurrence',
            sourceId: schedule.autoPausedByOccurrenceId,
            reason: 'resumed',
            resolvedByUserId: actorUserId,
          });
        }
      }
      const record = await transaction.workflowSchedule.findUnique({
        where: { id: scheduleId },
      });
      if (record === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      return toScheduleRecord(record as unknown as Record<string, unknown>);
    });
  }

  async archive(
    actorUserId: string,
    scheduleId: string,
    now: Date,
  ): Promise<WorkflowScheduleRecord> {
    return this.runSerializable(async (transaction) => {
      const schedule = await transaction.workflowSchedule.findUnique({
        where: { id: scheduleId },
        select: {
          id: true,
          workspaceId: true,
          status: true,
          autoPausedByOccurrenceId: true,
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
      if (schedule === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      const role = schedule.workspace.organization.members[0]?.role;
      if (
        role === undefined ||
        (role !== OrganizationRole.OWNER && role !== OrganizationRole.ADMIN)
      ) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_FORBIDDEN');
      }
      if (
        schedule.status !== WorkflowScheduleStatus.ACTIVE &&
        schedule.status !== WorkflowScheduleStatus.PAUSED &&
        schedule.status !== WorkflowScheduleStatus.AUTO_PAUSED &&
        schedule.status !== WorkflowScheduleStatus.COMPLETED
      ) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_ARCHIVED');
      }
      await transaction.workflowSchedule.update({
        where: { id: scheduleId },
        data: {
          status: WorkflowScheduleStatus.ARCHIVED,
          archivedAt: now,
          archivedByUserId: actorUserId,
        },
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildScheduleArchivedInput({
          workspaceId: schedule.workspaceId,
          actor: { type: 'user', userId: actorUserId },
          scheduleId,
          occurredAt: now,
        }),
      );
      if (schedule.status === WorkflowScheduleStatus.AUTO_PAUSED) {
        await this.operationalAlerts?.resolve(transaction, {
          workspaceId: schedule.workspaceId,
          type: 'schedule_auto_paused',
          sourceType: 'workflow_schedule',
          sourceId: schedule.id,
          reason: 'archived',
          resolvedByUserId: actorUserId,
          ignoreAlreadyResolved: true,
        });
        if (schedule.autoPausedByOccurrenceId !== null) {
          await this.operationalAlerts?.resolve(transaction, {
            workspaceId: schedule.workspaceId,
            type: 'schedule_auto_paused',
            sourceType: 'workflow_schedule_occurrence',
            sourceId: schedule.autoPausedByOccurrenceId,
            reason: 'archived',
            resolvedByUserId: actorUserId,
          });
        }
      }
      const record = await transaction.workflowSchedule.findUnique({
        where: { id: scheduleId },
      });
      if (record === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      return toScheduleRecord(record as unknown as Record<string, unknown>);
    });
  }

  async processOccurrence(input: {
    scheduleId: string;
    now: Date;
  }): Promise<OccurrenceDispatchResult | null> {
    return this.runSerializable(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "workflow_schedules"
        WHERE "id" = ${input.scheduleId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }

      const schedule = await transaction.workflowSchedule.findUnique({
        where: { id: input.scheduleId },
        select: {
          id: true,
          workspaceId: true,
          workflowId: true,
          workflowVersionId: true,
          workflowVersion: { select: { version: true, definition: true } },
          runnerDeviceId: true,
          definition: true,
          maxStartDelaySeconds: true,
          status: true,
          nextOccurrenceAt: true,
          createdByUserId: true,
        },
      });
      if (schedule === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      if (schedule.status !== WorkflowScheduleStatus.ACTIVE) {
        return null;
      }
      if (
        schedule.nextOccurrenceAt === null ||
        schedule.nextOccurrenceAt.getTime() > input.now.getTime()
      ) {
        return null;
      }

      const existingOccurrence =
        await transaction.workflowScheduleOccurrence.findFirst({
          where: {
            scheduleId: input.scheduleId,
            scheduledFor: schedule.nextOccurrenceAt,
            status: {
              in: [
                WorkflowScheduleOccurrenceStatus.PENDING,
                WorkflowScheduleOccurrenceStatus.DISPATCHED,
              ],
            },
          },
        });
      if (existingOccurrence !== null) {
        return {
          occurrence: toOccurrenceRecord(
            existingOccurrence as unknown as Record<string, unknown>,
          ),
          workflowRunId: existingOccurrence.workflowRunId,
          idempotent: true,
        };
      }

      const runner = await transaction.runnerDevice.findFirst({
        where: {
          id: schedule.runnerDeviceId,
          workspaceId: schedule.workspaceId,
        },
        select: {
          revokedAt: true,
          lastSeenAt: true,
          runnerVersion: true,
          platform: true,
          architecture: true,
          runProtocolVersion: true,
          workflowSchemaVersion: true,
          localStateSchemaVersion: true,
          serviceStatus: true,
          runtimeMetadataUpdatedAt: true,
          capabilities: true,
          secretInventory: {
            select: {
              storeStatus: true,
              vaultId: true,
              vaultRevision: true,
              inventoryDigest: true,
              entries: { select: { alias: true } },
            },
          },
        },
      });
      if (runner === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_RUNNER_MISMATCH');
      }
      if (runner.revokedAt !== null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_RUNNER_REVOKED');
      }
      const runnerOnline =
        runner.lastSeenAt !== null &&
        runner.lastSeenAt.getTime() > input.now.getTime() - 60_000;
      const maintenanceReportedAt = [
        runner.runtimeMetadataUpdatedAt,
        runner.lastSeenAt,
      ].reduce<Date | null>(
        (latest, candidate) =>
          candidate !== null &&
          (latest === null || candidate.getTime() > latest.getTime())
            ? candidate
            : latest,
        null,
      );
      const runnerInFreshUpdateMaintenance =
        runner.serviceStatus === 'draining' &&
        maintenanceReportedAt !== null &&
        maintenanceReportedAt.getTime() >
          input.now.getTime() - RUNNER_UPDATE_MAINTENANCE_FRESHNESS_MS;
      // Planned update maintenance takes precedence over a transient target
      // compatibility result. Claims remain blocked, but the occurrence is
      // skipped without auto-pausing while the controller can still roll back.
      if (runnerInFreshUpdateMaintenance) {
        return this.skipMaintenanceOccurrence(transaction, {
          scheduleId: schedule.id,
          workspaceId: schedule.workspaceId,
          definition: schedule.definition,
          scheduledFor: schedule.nextOccurrenceAt,
          maxStartDelaySeconds: schedule.maxStartDelaySeconds,
          now: input.now,
        });
      }
      const runnerCompatibility = evaluatePersistedRunnerCompatibility(runner);
      if (!canRunnerClaimJobs(runnerCompatibility)) {
        return this.autoPauseBlockedOccurrence(transaction, {
          scheduleId: schedule.id,
          workspaceId: schedule.workspaceId,
          createdByUserId: schedule.createdByUserId,
          scheduledFor: schedule.nextOccurrenceAt,
          maxStartDelaySeconds: schedule.maxStartDelaySeconds,
          now: input.now,
          skipReason: 'runner_update_required',
          autoPauseReason: 'runner_update_required',
        });
      }
      if (!runner.capabilities.includes(SCHEDULED_EXECUTION_CAPABILITY)) {
        throw new WorkflowScheduleRepositoryError('RUNNER_NOT_CAPABLE');
      }
      if (!runnerOnline) {
        throw new WorkflowScheduleRepositoryError('RUNNER_BUSY');
      }

      const activePolicy =
        await transaction.workspaceExecutionPolicyVersion.findFirst({
          where: {
            workspaceId: schedule.workspaceId,
            status: 'ACTIVE',
          },
          select: { id: true, revision: true, digest: true, definition: true },
        });
      if (activePolicy === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY');
      }
      const parsedPolicy = WorkspaceExecutionPolicyDefinitionSchema.safeParse(
        activePolicy.definition,
      );
      if (!parsedPolicy.success) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY');
      }
      const workflowDefParsed = WorkflowDefinitionSchema.safeParse(
        schedule.workflowVersion.definition,
      );
      if (!workflowDefParsed.success) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY');
      }
      const workflowDef = workflowDefParsed.data;
      const secretAnalysis = analyzeWorkflowInputs(workflowDef);
      const requiredAliases = [
        ...new Set(
          secretAnalysis.secretRequirements.map(
            (requirement) => requirement.secretName,
          ),
        ),
      ];
      const availableAliases = new Set(
        runner.secretInventory?.entries.map((entry) => entry.alias) ?? [],
      );
      const secretReady =
        requiredAliases.length === 0 ||
        (runner.capabilities.includes(LOCAL_SECRET_STORE_CAPABILITY) &&
          runner.secretInventory?.storeStatus === 'READY' &&
          requiredAliases.every((alias) => availableAliases.has(alias)));
      if (!secretReady) {
        return this.autoPauseBlockedOccurrence(transaction, {
          scheduleId: schedule.id,
          workspaceId: schedule.workspaceId,
          createdByUserId: schedule.createdByUserId,
          scheduledFor: schedule.nextOccurrenceAt,
          maxStartDelaySeconds: schedule.maxStartDelaySeconds,
          now: input.now,
          skipReason: 'secret_readiness_failed',
          autoPauseReason: 'secret_readiness_failed',
        });
      }
      const workflowDigest = createCanonicalJsonDigest(workflowDef);
      const policyEvaluation = evaluateWorkflowPolicy({
        policy: parsedPolicy.data,
        workflow: workflowDef,
        policyDigest: activePolicy.digest,
        workflowDigest,
      });
      if (
        policyEvaluation.overallDecision === 'deny' ||
        policyEvaluation.hasBlockingIssues
      ) {
        const occurrenceId = randomUUID();
        const scheduledFor = schedule.nextOccurrenceAt;
        const startDeadlineAt = new Date(
          scheduledFor.getTime() + schedule.maxStartDelaySeconds * 1000,
        );
        await transaction.workflowScheduleOccurrence.create({
          data: {
            id: occurrenceId,
            scheduleId: input.scheduleId,
            scheduledFor,
            startDeadlineAt,
            status: WorkflowScheduleOccurrenceStatus.SKIPPED,
            skipReason: 'policy_denied',
            skippedAt: input.now,
          },
        });
        await transaction.workflowSchedule.update({
          where: { id: input.scheduleId },
          data: {
            status: WorkflowScheduleStatus.AUTO_PAUSED,
            autoPauseReason: 'policy_review_required',
            autoPausedAt: input.now,
            autoPausedByOccurrenceId: occurrenceId,
          },
        });
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildOccurrenceSkippedInput({
            workspaceId: schedule.workspaceId,
            scheduleId: input.scheduleId,
            occurrenceId,
            reason: 'policy_denied',
            scheduledFor,
            occurredAt: input.now,
          }),
        );
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildScheduleAutoPausedInput({
            workspaceId: schedule.workspaceId,
            scheduleId: input.scheduleId,
            occurrenceId,
            reason: 'policy_review_required',
            occurredAt: input.now,
          }),
        );
        await this.operationalAlerts?.append(transaction, {
          schemaVersion: 1,
          workspaceId: schedule.workspaceId,
          type: 'schedule_auto_paused',
          source: { type: 'workflow_schedule', id: schedule.id },
          primaryEntity: { type: 'workflow_schedule', id: schedule.id },
          relatedEntities: [
            { type: 'workflow_schedule_occurrence', id: occurrenceId },
          ],
          template: {
            schemaVersion: 1,
            templateKey: 'schedule_auto_paused.v1',
            workflowScheduleId: schedule.id,
            reason: 'policy_review_required',
            autoPausedAt: input.now.toISOString(),
            occurrenceId,
          },
          actionTarget: {
            schemaVersion: 1,
            kind: 'schedule',
            workspaceId: schedule.workspaceId,
            workflowScheduleId: schedule.id,
          },
          creatorUserId: schedule.createdByUserId,
        });
        const occ = await transaction.workflowScheduleOccurrence.findUnique({
          where: { id: occurrenceId },
        });
        if (occ === null) {
          throw new WorkflowScheduleRepositoryError('OCCURRENCE_NOT_FOUND');
        }
        return {
          occurrence: toOccurrenceRecord(
            occ as unknown as Record<string, unknown>,
          ),
          workflowRunId: null,
          idempotent: false,
          skipReason: 'policy_denied',
          autoPaused: true,
          autoPauseReason: 'policy_review_required',
        };
      }

      const activeRunOnSchedule = await transaction.workflowRun.findFirst({
        where: {
          scheduleId: input.scheduleId,
          status: {
            in: [
              WorkflowRunStatus.QUEUED,
              WorkflowRunStatus.CLAIMED,
              WorkflowRunStatus.RUNNING,
              WorkflowRunStatus.WAITING_FOR_APPROVAL,
              WorkflowRunStatus.WAITING_FOR_REPAIR,
              WorkflowRunStatus.CANCEL_REQUESTED,
            ],
          },
        },
      });
      if (activeRunOnSchedule !== null) {
        throw new WorkflowScheduleRepositoryError('RUNNER_BUSY');
      }

      const activeRunOnRunner = await transaction.workflowRun.findFirst({
        where: {
          runnerDeviceId: schedule.runnerDeviceId,
          status: {
            in: [
              WorkflowRunStatus.QUEUED,
              WorkflowRunStatus.CLAIMED,
              WorkflowRunStatus.RUNNING,
              WorkflowRunStatus.WAITING_FOR_APPROVAL,
              WorkflowRunStatus.WAITING_FOR_REPAIR,
              WorkflowRunStatus.CANCEL_REQUESTED,
            ],
          },
        },
      });
      if (activeRunOnRunner !== null) {
        throw new WorkflowScheduleRepositoryError('RUNNER_BUSY');
      }

      const occurrenceId = randomUUID();
      const scheduledFor = schedule.nextOccurrenceAt;
      const startDeadlineAt = new Date(
        scheduledFor.getTime() + schedule.maxStartDelaySeconds * 1000,
      );
      const clientRunId = occurrenceId;

      const runCreated = await transaction.workflowRun.create({
        data: {
          workspaceId: schedule.workspaceId,
          workflowId: schedule.workflowId,
          workflowVersionId: schedule.workflowVersionId,
          runnerDeviceId: schedule.runnerDeviceId,
          createdByUserId: '00000000-0000-0000-0000-000000000000',
          clientRunId,
          runProtocolVersion: RUN_PROTOCOL_VERSION,
          workflowEngineVersion: 1,
          trigger: TRIGGER_SCHEDULED,
          scheduleId: input.scheduleId,
          occurrenceId,
          scheduledFor,
          scheduledStartDeadlineAt: startDeadlineAt,
          status: WorkflowRunStatus.QUEUED,
          definitionDigest: workflowDigest,
          policyVersionId: activePolicy.id,
          policyDigest: activePolicy.digest,
          allowedOrigins: [],
          executionOptions: {
            totalTimeoutMs: 3600_000,
            stepTimeoutMs: 300_000,
          },
          ...(requiredAliases.length > 0 && runner.secretInventory !== null
            ? {
                secretResolutionMode: 'LOCAL_STORE',
                secretVaultId: runner.secretInventory.vaultId,
                secretInventoryRevision: runner.secretInventory.vaultRevision,
                secretInventoryDigest: runner.secretInventory.inventoryDigest,
              }
            : {}),
        },
      });

      await transaction.workflowScheduleOccurrence.create({
        data: {
          id: occurrenceId,
          scheduleId: input.scheduleId,
          workflowRunId: runCreated.id,
          scheduledFor,
          startDeadlineAt,
          status: WorkflowScheduleOccurrenceStatus.DISPATCHED,
          dispatchedAt: input.now,
        },
      });

      const parsedDef = ScheduleDefinitionSchema.safeParse(schedule.definition);
      let nextOccurrenceAt: Date | null = null;
      if (parsedDef.success) {
        const nextResult = nextOccurrence(
          parsedDef.data,
          input.now,
          schedule.maxStartDelaySeconds,
        );
        if (!isOccurrenceSkipped(nextResult)) {
          nextOccurrenceAt = nextResult.scheduledInstant;
        }
      }

      await transaction.workflowSchedule.update({
        where: { id: input.scheduleId },
        data: {
          nextOccurrenceAt,
          lastOccurrenceAt: scheduledFor,
          ...(parsedDef.success && parsedDef.data.type === 'one_time'
            ? {
                status: WorkflowScheduleStatus.COMPLETED,
                completedAt: input.now,
              }
            : {}),
        },
      });

      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildOccurrenceDispatchedInput({
          workspaceId: schedule.workspaceId,
          scheduleId: input.scheduleId,
          occurrenceId,
          workflowRunId: runCreated.id,
          scheduledFor,
          startDeadlineAt,
          occurredAt: input.now,
        }),
      );

      const occ = await transaction.workflowScheduleOccurrence.findUnique({
        where: { id: occurrenceId },
      });
      if (occ === null) {
        throw new WorkflowScheduleRepositoryError('OCCURRENCE_NOT_FOUND');
      }
      return {
        occurrence: toOccurrenceRecord(
          occ as unknown as Record<string, unknown>,
        ),
        workflowRunId: runCreated.id,
        idempotent: false,
      };
    });
  }

  async reconcileTimedOutOccurrences(now: Date): Promise<number> {
    const timedOut = await this.prisma.workflowScheduleOccurrence.findMany({
      where: {
        status: WorkflowScheduleOccurrenceStatus.DISPATCHED,
        startDeadlineAt: { lt: now },
      },
      select: {
        id: true,
        scheduleId: true,
        workflowRunId: true,
        scheduledFor: true,
        startDeadlineAt: true,
      },
    });

    let count = 0;
    for (const occ of timedOut) {
      await this.runSerializable(async (transaction) => {
        const current = await transaction.workflowScheduleOccurrence.findUnique(
          {
            where: { id: occ.id },
            select: { status: true },
          },
        );
        if (
          current === null ||
          current.status !== WorkflowScheduleOccurrenceStatus.DISPATCHED
        ) {
          return;
        }

        await transaction.workflowScheduleOccurrence.update({
          where: { id: occ.id },
          data: {
            status: WorkflowScheduleOccurrenceStatus.TIMED_OUT,
            terminationCause: 'schedule_start_window_expired',
          },
        });

        if (occ.workflowRunId !== null) {
          const timedOutRun = await transaction.workflowRun.update({
            where: { id: occ.workflowRunId },
            data: {
              status: WorkflowRunStatus.TIMED_OUT,
              terminationCause: 'schedule_start_window_expired',
              finishedAt: now,
            },
            select: {
              id: true,
              workspaceId: true,
              createdByUserId: true,
              steps: { select: { id: true } },
              outputs: { select: { status: true } },
            },
          });
          await appendAuditEventTransactional(transaction, this.auditTrail, {
            workspaceId: timedOutRun.workspaceId,
            eventType: 'workflow_run.timed_out',
            actor: { type: 'system', reason: 'scheduler' },
            primaryEntity: { kind: 'workflow_run', id: timedOutRun.id },
            relatedEntities: [
              { kind: 'workflow_schedule_occurrence', id: occ.id },
            ],
            occurredAt: now,
            sourceId: createAuditSourceId(
              'workflow_run_terminal',
              [timedOutRun.id, 'workflow_run.timed_out', now.toISOString()],
              auditHasherForTrail,
            ),
            payload: {
              workflowRunId: timedOutRun.id,
              terminalStatus: 'timed_out',
              terminationCause: 'schedule_start_window_expired',
              finishedAt: now.toISOString(),
              stepCount: timedOutRun.steps.length,
              producedOutputCount: timedOutRun.outputs.filter(
                (output) => output.status === 'PRODUCED',
              ).length,
            },
          });
          await this.operationalAlerts?.append(transaction, {
            schemaVersion: 1,
            workspaceId: timedOutRun.workspaceId,
            type: 'run_timed_out',
            source: { type: 'workflow_run', id: timedOutRun.id },
            primaryEntity: { type: 'workflow_run', id: timedOutRun.id },
            relatedEntities: [
              { type: 'workflow_schedule_occurrence', id: occ.id },
            ],
            template: {
              schemaVersion: 1,
              templateKey: 'run_timed_out.v1',
              workflowRunId: timedOutRun.id,
              timedOutAt: now.toISOString(),
            },
            actionTarget: {
              schemaVersion: 1,
              kind: 'run',
              workspaceId: timedOutRun.workspaceId,
              workflowRunId: timedOutRun.id,
            },
            creatorUserId: timedOutRun.createdByUserId,
          });
        }

        const schedule = await transaction.workflowSchedule.findUnique({
          where: { id: occ.scheduleId },
          select: {
            workspaceId: true,
            definition: true,
            maxStartDelaySeconds: true,
          },
        });
        if (schedule !== null) {
          let nextOccurrenceAt: Date | null = null;
          const parsedDef = ScheduleDefinitionSchema.safeParse(
            schedule.definition,
          );
          if (parsedDef.success) {
            const nextResult = nextOccurrence(
              parsedDef.data,
              now,
              schedule.maxStartDelaySeconds,
            );
            if (!isOccurrenceSkipped(nextResult)) {
              nextOccurrenceAt = nextResult.scheduledInstant;
            }
          }
          await transaction.workflowSchedule.update({
            where: { id: occ.scheduleId },
            data: { nextOccurrenceAt },
          });

          if (occ.workflowRunId !== null) {
            await appendAuditEventTransactional(
              transaction,
              this.auditTrail,
              buildOccurrenceStartWindowExpiredInput({
                workspaceId: schedule.workspaceId,
                scheduleId: occ.scheduleId,
                occurrenceId: occ.id,
                workflowRunId: occ.workflowRunId,
                scheduledFor: occ.scheduledFor,
                startDeadlineAt: occ.startDeadlineAt,
                occurredAt: now,
              }),
            );
          }
        }
        count += 1;
      });
    }
    return count;
  }

  async handleRunCompletion(input: {
    occurrenceId: string;
    terminationCause: string | null;
    now: Date;
  }): Promise<OccurrenceDispatchResult> {
    return this.runSerializable(async (transaction) => {
      const occurrence =
        await transaction.workflowScheduleOccurrence.findUnique({
          where: { id: input.occurrenceId },
          select: {
            id: true,
            scheduleId: true,
            workflowRunId: true,
            status: true,
            scheduledFor: true,
          },
        });
      if (occurrence === null) {
        throw new WorkflowScheduleRepositoryError('OCCURRENCE_NOT_FOUND');
      }

      const TERMINAL_STATUSES: WorkflowScheduleOccurrenceStatus[] = [
        WorkflowScheduleOccurrenceStatus.SUCCEEDED,
        WorkflowScheduleOccurrenceStatus.SKIPPED,
        WorkflowScheduleOccurrenceStatus.TIMED_OUT,
        WorkflowScheduleOccurrenceStatus.CANCELLED,
      ];
      if (TERMINAL_STATUSES.includes(occurrence.status)) {
        const occ = await transaction.workflowScheduleOccurrence.findUnique({
          where: { id: input.occurrenceId },
        });
        if (occ === null) {
          throw new WorkflowScheduleRepositoryError('OCCURRENCE_NOT_FOUND');
        }
        return {
          occurrence: toOccurrenceRecord(
            occ as unknown as Record<string, unknown>,
          ),
          workflowRunId: occ.workflowRunId,
          idempotent: true,
        };
      }

      if (occurrence.status !== WorkflowScheduleOccurrenceStatus.DISPATCHED) {
        throw new WorkflowScheduleRepositoryError('OCCURRENCE_INVALID');
      }

      let status: WorkflowScheduleOccurrenceStatus;
      let autoPause = false;
      let autoPauseReason:
        | 'policy_review_required'
        | 'source_version_unavailable'
        | 'ambiguous_outcome'
        | undefined;

      const run =
        occurrence.workflowRunId !== null
          ? await transaction.workflowRun.findUnique({
              where: { id: occurrence.workflowRunId },
              select: { status: true },
            })
          : null;

      if (run !== null && run.status === WorkflowRunStatus.SUCCEEDED) {
        status = WorkflowScheduleOccurrenceStatus.SUCCEEDED;
      } else if (run !== null && run.status === WorkflowRunStatus.INTERRUPTED) {
        status = WorkflowScheduleOccurrenceStatus.CANCELLED;
        autoPause = true;
        autoPauseReason = 'ambiguous_outcome';
      } else if (run !== null && run.status === WorkflowRunStatus.FAILED) {
        const sideEffectUnknown =
          input.terminationCause === 'ambiguous_outcome' ||
          input.terminationCause === 'runner_crash' ||
          input.terminationCause === 'lease_expired';
        if (sideEffectUnknown) {
          autoPause = true;
          autoPauseReason = 'ambiguous_outcome';
        }
        status = WorkflowScheduleOccurrenceStatus.SKIPPED;
      } else if (
        run !== null &&
        (run.status === WorkflowRunStatus.CANCELLED ||
          run.status === WorkflowRunStatus.TIMED_OUT)
      ) {
        status = WorkflowScheduleOccurrenceStatus.SKIPPED;
      } else {
        status = WorkflowScheduleOccurrenceStatus.CANCELLED;
      }

      await transaction.workflowScheduleOccurrence.update({
        where: { id: input.occurrenceId },
        data: {
          status,
          terminationCause: input.terminationCause,
          completedAt: input.now,
        },
      });

      const schedule = await transaction.workflowSchedule.findUnique({
        where: { id: occurrence.scheduleId },
        select: {
          id: true,
          workspaceId: true,
          status: true,
          definition: true,
          maxStartDelaySeconds: true,
          autoPausedByOccurrenceId: true,
          createdByUserId: true,
        },
      });
      if (schedule === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }

      await transaction.workflowSchedule.update({
        where: { id: occurrence.scheduleId },
        data: {
          lastOccurrenceAt: occurrence.scheduledFor,
          ...(autoPause
            ? {
                status: WorkflowScheduleStatus.AUTO_PAUSED,
                autoPauseReason: autoPauseReason ?? 'ambiguous_outcome',
                autoPausedAt: input.now,
                autoPausedByOccurrenceId: occurrence.id,
              }
            : {}),
        },
      });

      let nextOccurrenceAt: Date | null = null;
      if (!autoPause) {
        const parsedDef = ScheduleDefinitionSchema.safeParse(
          schedule.definition,
        );
        if (parsedDef.success) {
          const nextResult = nextOccurrence(
            parsedDef.data,
            input.now,
            schedule.maxStartDelaySeconds,
          );
          if (!isOccurrenceSkipped(nextResult)) {
            nextOccurrenceAt = nextResult.scheduledInstant;
          }
        }
        await transaction.workflowSchedule.update({
          where: { id: occurrence.scheduleId },
          data: { nextOccurrenceAt },
        });
      }

      if (
        status === WorkflowScheduleOccurrenceStatus.SUCCEEDED &&
        occurrence.workflowRunId !== null
      ) {
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildOccurrenceSucceededInput({
            workspaceId: schedule.workspaceId,
            scheduleId: occurrence.scheduleId,
            occurrenceId: occurrence.id,
            workflowRunId: occurrence.workflowRunId,
            occurredAt: input.now,
          }),
        );
      }

      if (autoPause && autoPauseReason !== undefined) {
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildScheduleAutoPausedInput({
            workspaceId: schedule.workspaceId,
            scheduleId: occurrence.scheduleId,
            occurrenceId: occurrence.id,
            reason: autoPauseReason,
            occurredAt: input.now,
          }),
        );
        await this.operationalAlerts?.append(transaction, {
          schemaVersion: 1,
          workspaceId: schedule.workspaceId,
          type: 'schedule_auto_paused',
          source: { type: 'workflow_schedule', id: occurrence.scheduleId },
          primaryEntity: {
            type: 'workflow_schedule',
            id: occurrence.scheduleId,
          },
          relatedEntities: [
            { type: 'workflow_schedule_occurrence', id: occurrence.id },
          ],
          template: {
            schemaVersion: 1,
            templateKey: 'schedule_auto_paused.v1',
            workflowScheduleId: occurrence.scheduleId,
            reason: autoPauseReason,
            autoPausedAt: input.now.toISOString(),
            occurrenceId: occurrence.id,
          },
          actionTarget: {
            schemaVersion: 1,
            kind: 'schedule',
            workspaceId: schedule.workspaceId,
            workflowScheduleId: occurrence.scheduleId,
          },
          creatorUserId: schedule.createdByUserId,
        });
      }

      const updatedOcc =
        await transaction.workflowScheduleOccurrence.findUnique({
          where: { id: input.occurrenceId },
        });
      if (updatedOcc === null) {
        throw new WorkflowScheduleRepositoryError('OCCURRENCE_NOT_FOUND');
      }
      return {
        occurrence: toOccurrenceRecord(
          updatedOcc as unknown as Record<string, unknown>,
        ),
        workflowRunId: updatedOcc.workflowRunId,
        idempotent: false,
      };
    });
  }

  async reconcileTerminalOccurrences(now: Date): Promise<number> {
    const occurrences = await this.prisma.workflowScheduleOccurrence.findMany({
      where: {
        status: WorkflowScheduleOccurrenceStatus.DISPATCHED,
        workflowRun: {
          status: {
            in: [
              WorkflowRunStatus.SUCCEEDED,
              WorkflowRunStatus.FAILED,
              WorkflowRunStatus.CANCELLED,
              WorkflowRunStatus.TIMED_OUT,
              WorkflowRunStatus.INTERRUPTED,
            ],
          },
        },
      },
      select: { id: true, workflowRun: { select: { terminationCause: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    for (const occurrence of occurrences) {
      await this.handleRunCompletion({
        occurrenceId: occurrence.id,
        terminationCause: occurrence.workflowRun?.terminationCause ?? null,
        now,
      });
    }
    return occurrences.length;
  }

  /**
   * Resolve the access details for a specific schedule. Used by the
   * organisation-resource-context guard to authorise schedule operations.
   *
   * Returns null if the user is not a member of the schedule's workspace.
   */
  async resolveScheduleAccess(
    userId: string,
    scheduleId: string,
  ): Promise<WorkflowScheduleAccess | null> {
    const row = await this.prisma.workflowSchedule.findFirst({
      where: {
        id: scheduleId,
        workspace: {
          organization: { members: { some: { userId } } },
        },
      },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            organizationId: true,
            organization: {
              select: {
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
    if (row === null) return null;
    const role = row.workspace.organization.members[0]?.role;
    if (role === undefined) return null;
    return {
      workspaceId: row.workspaceId,
      organizationId: row.workspace.organizationId,
      userId,
      role,
    };
  }

  /**
   * Select schedules whose `nextOccurrenceAt` is at or before `now` and whose
   * status is `ACTIVE`. Used by the scheduler to enumerate due occurrences.
   */
  async selectDueSchedules(now: Date): Promise<
    {
      scheduleId: string;
      workspaceId: string;
      nextOccurrenceAt: Date;
    }[]
  > {
    const rows = await this.prisma.workflowSchedule.findMany({
      where: {
        status: WorkflowScheduleStatus.ACTIVE,
        nextOccurrenceAt: { lte: now, not: null },
      },
      select: {
        id: true,
        workspaceId: true,
        nextOccurrenceAt: true,
      },
      orderBy: { nextOccurrenceAt: 'asc' },
      take: 500,
    });
    return rows
      .filter(
        (row): row is typeof row & { nextOccurrenceAt: Date } =>
          row.nextOccurrenceAt !== null,
      )
      .map((row) => ({
        scheduleId: row.id,
        workspaceId: row.workspaceId,
        nextOccurrenceAt: row.nextOccurrenceAt,
      }));
  }

  private async autoPauseBlockedOccurrence(
    transaction: Prisma.TransactionClient,
    input: {
      scheduleId: string;
      workspaceId: string;
      createdByUserId: string;
      scheduledFor: Date;
      maxStartDelaySeconds: number;
      now: Date;
      skipReason: 'secret_readiness_failed' | 'runner_update_required';
      autoPauseReason: 'secret_readiness_failed' | 'runner_update_required';
    },
  ): Promise<OccurrenceDispatchResult> {
    const occurrenceId = randomUUID();
    const startDeadlineAt = new Date(
      input.scheduledFor.getTime() + input.maxStartDelaySeconds * 1_000,
    );
    const occurrence = await transaction.workflowScheduleOccurrence.create({
      data: {
        id: occurrenceId,
        scheduleId: input.scheduleId,
        scheduledFor: input.scheduledFor,
        startDeadlineAt,
        status: WorkflowScheduleOccurrenceStatus.SKIPPED,
        skipReason: input.skipReason,
        skippedAt: input.now,
      },
    });
    await transaction.workflowSchedule.update({
      where: { id: input.scheduleId },
      data: {
        status: WorkflowScheduleStatus.AUTO_PAUSED,
        autoPauseReason: input.autoPauseReason,
        autoPausedAt: input.now,
        autoPausedByOccurrenceId: occurrenceId,
        nextOccurrenceAt: null,
        lastOccurrenceAt: input.scheduledFor,
      },
    });
    await appendAuditEventTransactional(
      transaction,
      this.auditTrail,
      buildOccurrenceSkippedInput({
        workspaceId: input.workspaceId,
        scheduleId: input.scheduleId,
        occurrenceId,
        reason: input.skipReason,
        scheduledFor: input.scheduledFor,
        occurredAt: input.now,
      }),
    );
    await appendAuditEventTransactional(
      transaction,
      this.auditTrail,
      buildScheduleAutoPausedInput({
        workspaceId: input.workspaceId,
        scheduleId: input.scheduleId,
        occurrenceId,
        reason: input.autoPauseReason,
        occurredAt: input.now,
      }),
    );
    await this.operationalAlerts?.append(transaction, {
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      type: 'schedule_auto_paused',
      source: { type: 'workflow_schedule_occurrence', id: occurrenceId },
      primaryEntity: { type: 'workflow_schedule', id: input.scheduleId },
      relatedEntities: [
        { type: 'workflow_schedule_occurrence', id: occurrenceId },
      ],
      template: {
        schemaVersion: 1,
        templateKey: 'schedule_auto_paused.v1',
        workflowScheduleId: input.scheduleId,
        reason: input.autoPauseReason,
        autoPausedAt: input.now.toISOString(),
        occurrenceId,
      },
      actionTarget: {
        schemaVersion: 1,
        kind: 'schedule',
        workspaceId: input.workspaceId,
        workflowScheduleId: input.scheduleId,
      },
      creatorUserId: input.createdByUserId,
    });
    return {
      occurrence: toOccurrenceRecord(
        occurrence as unknown as Record<string, unknown>,
      ),
      workflowRunId: null,
      idempotent: false,
      skipReason: input.skipReason,
      autoPaused: true,
      autoPauseReason: input.autoPauseReason,
    };
  }

  private async skipMaintenanceOccurrence(
    transaction: Prisma.TransactionClient,
    input: {
      scheduleId: string;
      workspaceId: string;
      definition: unknown;
      scheduledFor: Date;
      maxStartDelaySeconds: number;
      now: Date;
    },
  ): Promise<OccurrenceDispatchResult> {
    const parsedDefinition = ScheduleDefinitionSchema.safeParse(
      input.definition,
    );
    if (!parsedDefinition.success) {
      throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_READY');
    }

    const occurrenceId = randomUUID();
    const startDeadlineAt = new Date(
      input.scheduledFor.getTime() + input.maxStartDelaySeconds * 1_000,
    );
    const occurrence = await transaction.workflowScheduleOccurrence.create({
      data: {
        id: occurrenceId,
        scheduleId: input.scheduleId,
        scheduledFor: input.scheduledFor,
        startDeadlineAt,
        status: WorkflowScheduleOccurrenceStatus.SKIPPED,
        skipReason: 'runner_maintenance',
        skippedAt: input.now,
      },
    });

    const isOneTime = parsedDefinition.data.type === 'one_time';
    const nextResult = isOneTime
      ? null
      : nextOccurrence(
          parsedDefinition.data,
          input.now,
          input.maxStartDelaySeconds,
        );
    const nextOccurrenceAt =
      nextResult === null || isOccurrenceSkipped(nextResult)
        ? null
        : nextResult.scheduledInstant;

    await transaction.workflowSchedule.update({
      where: { id: input.scheduleId },
      data: {
        nextOccurrenceAt,
        lastOccurrenceAt: input.scheduledFor,
        ...(isOneTime
          ? {
              status: WorkflowScheduleStatus.COMPLETED,
              completedAt: input.now,
            }
          : {}),
      },
    });
    await appendAuditEventTransactional(
      transaction,
      this.auditTrail,
      buildOccurrenceSkippedInput({
        workspaceId: input.workspaceId,
        scheduleId: input.scheduleId,
        occurrenceId,
        reason: 'runner_maintenance',
        scheduledFor: input.scheduledFor,
        occurredAt: input.now,
      }),
    );

    return {
      occurrence: toOccurrenceRecord(
        occurrence as unknown as Record<string, unknown>,
      ),
      workflowRunId: null,
      idempotent: false,
      skipReason: 'runner_maintenance',
      autoPaused: false,
    };
  }

  private async resolveWorkspaceAccess(
    client: Prisma.TransactionClient | PrismaClient,
    userId: string,
    workspaceId: string,
  ): Promise<WorkflowScheduleAccess | null> {
    const row = await client.workspace.findFirst({
      where: {
        id: workspaceId,
        organization: { members: { some: { userId } } },
      },
      select: {
        id: true,
        organizationId: true,
        organization: {
          select: {
            members: {
              where: { userId },
              select: { role: true },
              take: 1,
            },
          },
        },
      },
    });
    const role = row?.organization.members[0]?.role;
    return row === null || role === undefined
      ? null
      : {
          workspaceId: row.id,
          organizationId: row.organizationId,
          userId,
          role,
        };
  }

  private async getOccurrenceCreatedAt(occurrenceId: string): Promise<Date> {
    const occ = await this.prisma.workflowScheduleOccurrence.findUnique({
      where: { id: occurrenceId },
      select: { createdAt: true },
    });
    if (occ === null) {
      throw new WorkflowScheduleRepositoryError('OCCURRENCE_NOT_FOUND');
    }
    return occ.createdAt;
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
            throw new WorkflowScheduleRepositoryError('SERIALIZATION_FAILURE');
          }
          throw error;
        }
      }
    }
    throw new WorkflowScheduleRepositoryError('SERIALIZATION_FAILURE');
  }
}
