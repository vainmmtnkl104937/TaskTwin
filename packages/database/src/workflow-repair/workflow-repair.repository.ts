import {
  MAX_REPAIR_TIMEOUT_MS,
  RecoveryModeSchema,
  decideRetry,
  isApprovalGatedStep,
  type RunnerRepairRequestCreate,
} from '@tasktwin/workflow-recovery';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import {
  createAuditSourceId,
  type AuditEventInput,
} from '@tasktwin/audit-trail';

import {
  OrganizationRole,
  Prisma,
  WorkflowExecutionEffectCertainty,
  WorkflowRepairRequestStatus,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  type PrismaClient,
} from '../generated/prisma/client.js';
import {
  appendAuditEventTransactional,
  auditHasherForTrail,
} from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { WorkflowRepairRepositoryError } from './workflow-repair-errors.js';
import type {
  WorkflowRepairAccess,
  WorkflowRepairDecisionResult,
  WorkflowRepairRecord,
} from './workflow-repair-records.js';
import type { OperationalAlertTransactionAppender } from '../operational-alerts/operational-alert-port.js';

const REPAIR_EVENT_NAMESPACES = {
  requested: 'repair_requested',
  decided: 'repair_decided',
  lifecycle: 'repair_lifecycle',
} as const;

function buildRepairRequestedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  repairRequestId: string;
  workflowRunId: string;
  stepId: string;
  stepIndex: number;
  attemptNumber: number;
  safeErrorCode: string;
  effectCertainty:
    | 'not_started'
    | 'read_only'
    | 'side_effect_possible'
    | 'completed'
    | 'unknown';
  retryAllowed: boolean;
  requestedAt: Date;
  expiresAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'repair.requested',
    actor: input.actor,
    primaryEntity: { kind: 'repair_request', id: input.repairRequestId },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.requestedAt,
    sourceId: createAuditSourceId(
      REPAIR_EVENT_NAMESPACES.requested,
      [input.repairRequestId],
      auditHasherForTrail,
    ),
    payload: {
      repairRequestId: input.repairRequestId,
      workflowRunId: input.workflowRunId,
      stepId: input.stepId,
      stepIndex: input.stepIndex,
      attemptNumber: input.attemptNumber,
      safeErrorCode: input.safeErrorCode,
      effectCertainty: input.effectCertainty,
      retryAllowed: input.retryAllowed,
      requestedAt: input.requestedAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
    },
  };
}

function buildRepairDecidedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  repairRequestId: string;
  workflowRunId: string;
  decision: 'retry_approved' | 'aborted';
  resolvedAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'repair.decided',
    actor: input.actor,
    primaryEntity: { kind: 'repair_request', id: input.repairRequestId },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.resolvedAt,
    sourceId: createAuditSourceId(
      REPAIR_EVENT_NAMESPACES.decided,
      [input.repairRequestId, input.decision, input.resolvedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      repairRequestId: input.repairRequestId,
      workflowRunId: input.workflowRunId,
      decision: input.decision,
      decidedByUserId: input.actor.userId,
      resolvedAt: input.resolvedAt.toISOString(),
    },
  };
}

function buildRepairLifecycleInput(input: {
  workspaceId: string;
  actor: { type: 'system'; reason: 'automatic_expiry' };
  repairRequestId: string;
  workflowRunId: string;
  reason: 'expired' | 'cancelled' | 'invalidated';
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
      REPAIR_EVENT_NAMESPACES.lifecycle,
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

const DECIDERS = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;
const ABORTERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;

const repairInclude = {
  workflowRun: {
    include: {
      workflow: { select: { name: true } },
      workflowVersion: { select: { version: true, definition: true } },
    },
  },
  runnerDevice: { select: { id: true, displayName: true } },
} as const satisfies Prisma.WorkflowRepairRequestInclude;

type RepairRow = Prisma.WorkflowRepairRequestGetPayload<{
  include: typeof repairInclude;
}>;

function effectFromDatabase(
  value: WorkflowExecutionEffectCertainty,
): WorkflowRepairRecord['effectCertainty'] {
  switch (value) {
    case WorkflowExecutionEffectCertainty.NOT_STARTED:
      return 'not_started';
    case WorkflowExecutionEffectCertainty.READ_ONLY:
      return 'read_only';
    case WorkflowExecutionEffectCertainty.SIDE_EFFECT_POSSIBLE:
      return 'side_effect_possible';
    case WorkflowExecutionEffectCertainty.COMPLETED:
      return 'completed';
    case WorkflowExecutionEffectCertainty.UNKNOWN:
      return 'unknown';
  }
}

function effectToDatabase(
  value: WorkflowRepairRecord['effectCertainty'],
): WorkflowExecutionEffectCertainty {
  return {
    not_started: WorkflowExecutionEffectCertainty.NOT_STARTED,
    read_only: WorkflowExecutionEffectCertainty.READ_ONLY,
    side_effect_possible: WorkflowExecutionEffectCertainty.SIDE_EFFECT_POSSIBLE,
    completed: WorkflowExecutionEffectCertainty.COMPLETED,
    unknown: WorkflowExecutionEffectCertainty.UNKNOWN,
  }[value];
}

function toRecord(row: RepairRow): WorkflowRepairRecord {
  const workflow = WorkflowDefinitionSchema.parse(
    row.workflowRun.workflowVersion.definition,
  );
  const step = workflow.steps[row.stepIndex];
  if (step === undefined || step.id !== row.stepId) {
    throw new WorkflowRepairRepositoryError('REPAIR_INVALID');
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowRunId: row.workflowRunId,
    workflowId: row.workflowRun.workflowId,
    workflowName: row.workflowRun.workflow.name,
    workflowVersion: row.workflowRun.workflowVersion.version,
    runner: { id: row.runnerDevice.id, name: row.runnerDevice.displayName },
    step: {
      id: step.id,
      index: row.stepIndex,
      name: step.name,
      type: step.type,
    },
    attemptNumber: row.attemptNumber,
    safeErrorCode: row.safeErrorCode,
    effectCertainty: effectFromDatabase(row.effectCertainty),
    retryAllowed: row.retryAllowed,
    status: row.status,
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt,
  };
}

function readRecoveryMode(options: Prisma.JsonValue) {
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new WorkflowRepairRepositoryError('REPAIR_INVALID');
  }
  const parsed = RecoveryModeSchema.safeParse(
    options.recoveryMode ?? 'automatic_safe_only',
  );
  if (!parsed.success) {
    throw new WorkflowRepairRepositoryError('REPAIR_INVALID');
  }
  return parsed.data;
}

export class WorkflowRepairRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditTrail: WorkspaceAuditTrailRepository = new WorkspaceAuditTrailRepository(
      prisma,
    ),
    private readonly operationalAlerts?: OperationalAlertTransactionAppender,
  ) {}

  async resolveRepairAccess(
    userId: string,
    repairRequestId: string,
  ): Promise<WorkflowRepairAccess | null> {
    const row = await this.prisma.workflowRepairRequest.findFirst({
      where: {
        id: repairRequestId,
        workflowRun: {
          workspace: { organization: { members: { some: { userId } } } },
        },
      },
      select: {
        workspaceId: true,
        workflowRun: {
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
        },
      },
    });
    const member = row?.workflowRun.workspace.organization.members[0];
    return row === null || row === undefined || member === undefined
      ? null
      : {
          userId,
          organizationId: row.workflowRun.workspace.organization.id,
          workspaceId: row.workspaceId,
          role: member.role,
        };
  }

  async createForRunner(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    request: RunnerRepairRequestCreate;
    now: Date;
  }): Promise<{ idempotent: boolean; record: WorkflowRepairRecord }> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM "workflow_runs" WHERE id = ${input.workflowRunId}::uuid FOR UPDATE`;
        const run = await transaction.workflowRun.findUnique({
          where: { id: input.workflowRunId },
          include: {
            workflow: { select: { name: true } },
            workflowVersion: { select: { version: true, definition: true } },
            steps: {
              include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
            },
          },
        });
        if (run === null)
          throw new WorkflowRepairRepositoryError('RUN_NOT_FOUND');
        if (run.runnerDeviceId !== input.runnerDeviceId) {
          throw new WorkflowRepairRepositoryError('RUNNER_MISMATCH');
        }
        if (
          run.leaseTokenHash !== input.leaseTokenHash ||
          run.leaseExpiresAt === null ||
          run.leaseExpiresAt <= input.now
        ) {
          throw new WorkflowRepairRepositoryError('LEASE_INVALID');
        }
        if (
          run.status !== WorkflowRunStatus.RUNNING &&
          run.status !== WorkflowRunStatus.WAITING_FOR_REPAIR
        ) {
          throw new WorkflowRepairRepositoryError('REPAIR_CONFLICT');
        }
        const workflow = WorkflowDefinitionSchema.parse(
          run.workflowVersion.definition,
        );
        const stepIndex = workflow.steps.findIndex(
          (step) => step.id === input.request.stepId,
        );
        const step = workflow.steps[stepIndex];
        const storedStep = run.steps.find(
          (candidate) => candidate.sourceStepId === input.request.stepId,
        );
        const attempt = storedStep?.attempts.at(-1);
        if (
          step === undefined ||
          storedStep === undefined ||
          attempt === undefined ||
          attempt.attemptNumber !== input.request.attemptNumber ||
          attempt.safeErrorCode !== input.request.safeErrorCode ||
          attempt.effectCertainty !==
            effectToDatabase(input.request.effectCertainty) ||
          attempt.finishedAt === null
        ) {
          throw new WorkflowRepairRepositoryError('REPAIR_INVALID');
        }
        const decision = decideRetry({
          stepType: step.type,
          errorCode: input.request.safeErrorCode,
          effectCertainty: input.request.effectCertainty,
          recoveryMode: readRecoveryMode(run.executionOptions),
          automaticRetryCount: storedStep.attempts.filter(
            (item) => item.trigger === 'AUTOMATIC_RETRY',
          ).length,
          manualRetryCount: storedStep.attempts.filter(
            (item) => item.trigger === 'MANUAL_RETRY',
          ).length,
          totalAttemptCount: storedStep.attempts.length,
          approvalGated: isApprovalGatedStep(workflow, step.id),
        });
        if (
          decision.disposition !== 'manual_repair' &&
          decision.disposition !== 'locator_proposal'
        ) {
          throw new WorkflowRepairRepositoryError('REPAIR_INVALID');
        }
        const expiresAt = new Date(input.request.expiresAt);
        if (
          expiresAt <= input.now ||
          expiresAt.getTime() > input.now.getTime() + MAX_REPAIR_TIMEOUT_MS
        ) {
          throw new WorkflowRepairRepositoryError('REPAIR_INVALID');
        }
        const digest = createCanonicalJsonDigest(input.request);
        const existing = await transaction.workflowRepairRequest.findFirst({
          where: {
            workflowRunId: run.id,
            OR: [
              { clientRequestId: input.request.clientRequestId },
              { stepId: step.id, attemptNumber: input.request.attemptNumber },
            ],
          },
          include: repairInclude,
        });
        if (existing !== null) {
          if (
            existing.clientRequestId !== input.request.clientRequestId ||
            existing.requestDigest !== digest
          ) {
            throw new WorkflowRepairRepositoryError('REPAIR_CONFLICT');
          }
          return { idempotent: true, record: toRecord(existing) };
        }
        const created = await transaction.workflowRepairRequest.create({
          data: {
            workflowRunId: run.id,
            workspaceId: run.workspaceId,
            runnerDeviceId: input.runnerDeviceId,
            stepId: step.id,
            stepIndex,
            attemptNumber: input.request.attemptNumber,
            clientRequestId: input.request.clientRequestId,
            requestDigest: digest,
            safeErrorCode: input.request.safeErrorCode,
            effectCertainty: effectToDatabase(input.request.effectCertainty),
            retryAllowed: decision.retryAllowed,
            requestedAt: input.now,
            expiresAt,
          },
          include: repairInclude,
        });
        await transaction.workflowRun.update({
          where: { id: run.id },
          data: { status: WorkflowRunStatus.WAITING_FOR_REPAIR },
        });
        await transaction.workflowRunStep.update({
          where: { id: storedStep.id },
          data: { status: WorkflowRunStepStatus.WAITING_FOR_REPAIR },
        });
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildRepairRequestedInput({
            workspaceId: run.workspaceId,
            actor: {
              type: 'runner',
              runnerDeviceId: input.runnerDeviceId,
            },
            repairRequestId: created.id,
            workflowRunId: run.id,
            stepId: step.id,
            stepIndex,
            attemptNumber: input.request.attemptNumber,
            safeErrorCode: input.request.safeErrorCode,
            effectCertainty: input.request.effectCertainty,
            retryAllowed: decision.retryAllowed,
            requestedAt: input.now,
            expiresAt,
          }),
        );
        await this.operationalAlerts?.append(transaction, {
          schemaVersion: 1, workspaceId: run.workspaceId, type: 'repair_required',
          source: { type: 'repair_request', id: created.id },
          primaryEntity: { type: 'repair_request', id: created.id },
          relatedEntities: [{ type: 'workflow_run', id: run.id }],
          template: {
            schemaVersion: 1, templateKey: 'repair_required.v1',
            repairRequestId: created.id, workflowRunId: run.id,
            stepType: step.type, attemptNumber: input.request.attemptNumber,
            expiresAt: expiresAt.toISOString(),
          },
          actionTarget: { schemaVersion: 1, kind: 'repair',
            workspaceId: run.workspaceId, repairRequestId: created.id },
        });
        return { idempotent: false, record: toRecord(created) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getForRunner(input: {
    workflowRunId: string;
    repairRequestId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    now: Date;
  }): Promise<WorkflowRepairRecord> {
    const authorized = await this.prisma.workflowRepairRequest.findFirst({
      where: {
        id: input.repairRequestId,
        workflowRunId: input.workflowRunId,
        runnerDeviceId: input.runnerDeviceId,
        workflowRun: {
          leaseTokenHash: input.leaseTokenHash,
          leaseExpiresAt: { gt: input.now },
          status: {
            in: [
              WorkflowRunStatus.RUNNING,
              WorkflowRunStatus.WAITING_FOR_REPAIR,
            ],
          },
        },
      },
      select: { id: true },
    });
    if (authorized === null) {
      throw new WorkflowRepairRepositoryError('REPAIR_NOT_FOUND');
    }
    await this.expire(input.repairRequestId, input.now, false);
    const row = await this.prisma.workflowRepairRequest.findUnique({
      where: { id: authorized.id },
      include: repairInclude,
    });
    if (row === null)
      throw new WorkflowRepairRepositoryError('REPAIR_NOT_FOUND');
    return toRecord(row);
  }

  async listForWorkspace(userId: string, workspaceId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId,
        organization: { workspaces: { some: { id: workspaceId } } },
      },
      select: { role: true, organizationId: true },
    });
    if (membership === null) {
      throw new WorkflowRepairRepositoryError('REPAIR_FORBIDDEN');
    }
    const expired = await this.prisma.workflowRepairRequest.findMany({
      where: {
        workspaceId,
        status: WorkflowRepairRequestStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      select: { id: true },
      take: 1000,
    });
    for (const request of expired) await this.expire(request.id, new Date());
    const rows = await this.prisma.workflowRepairRequest.findMany({
      where: { workspaceId },
      orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
      take: 1000,
      include: repairInclude,
    });
    return {
      access: {
        userId,
        organizationId: membership.organizationId,
        workspaceId,
        role: membership.role,
      },
      records: rows.map(toRecord),
    };
  }

  async getForUser(userId: string, repairRequestId: string) {
    await this.expire(repairRequestId, new Date());
    const access = await this.resolveRepairAccess(userId, repairRequestId);
    if (access === null)
      throw new WorkflowRepairRepositoryError('REPAIR_NOT_FOUND');
    const row = await this.prisma.workflowRepairRequest.findUnique({
      where: { id: repairRequestId },
      include: repairInclude,
    });
    if (row === null)
      throw new WorkflowRepairRepositoryError('REPAIR_NOT_FOUND');
    return { access, record: toRecord(row) };
  }

  async decide(input: {
    userId: string;
    repairRequestId: string;
    decision: 'RETRY_APPROVED' | 'ABORTED';
    clientDecisionId: string;
    now: Date;
  }): Promise<WorkflowRepairDecisionResult> {
    await this.expire(input.repairRequestId, input.now);
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM "workflow_repair_requests" WHERE id = ${input.repairRequestId}::uuid FOR UPDATE`;
        const reused = await transaction.workflowRepairRequest.findUnique({
          where: { clientDecisionId: input.clientDecisionId },
          select: { id: true },
        });
        if (reused !== null && reused.id !== input.repairRequestId) {
          throw new WorkflowRepairRepositoryError('REPAIR_CONFLICT');
        }
        const row = await transaction.workflowRepairRequest.findUnique({
          where: { id: input.repairRequestId },
          include: {
            ...repairInclude,
            workflowRun: {
              include: {
                workflow: { select: { name: true } },
                workflowVersion: {
                  select: { version: true, definition: true },
                },
                workspace: {
                  select: {
                    organization: {
                      select: {
                        members: {
                          where: { userId: input.userId },
                          select: { role: true },
                          take: 1,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        const role = row?.workflowRun.workspace.organization.members[0]?.role;
        if (row === null || row === undefined || role === undefined) {
          throw new WorkflowRepairRepositoryError('REPAIR_NOT_FOUND');
        }
        const allowed =
          input.decision === 'RETRY_APPROVED'
            ? DECIDERS.includes(role as (typeof DECIDERS)[number])
            : ABORTERS.includes(role as (typeof ABORTERS)[number]);
        if (!allowed)
          throw new WorkflowRepairRepositoryError('REPAIR_FORBIDDEN');
        if (
          row.clientDecisionId === input.clientDecisionId &&
          row.status === input.decision
        ) {
          return { idempotent: true, record: toRecord(row) };
        }
        if (
          row.status !== WorkflowRepairRequestStatus.PENDING ||
          row.expiresAt <= input.now ||
          (input.decision === 'RETRY_APPROVED' && !row.retryAllowed)
        ) {
          throw new WorkflowRepairRepositoryError('REPAIR_CONFLICT');
        }
        const updated = await transaction.workflowRepairRequest.updateMany({
          where: {
            id: row.id,
            status: WorkflowRepairRequestStatus.PENDING,
            clientDecisionId: null,
          },
          data: {
            status: input.decision,
            resolvedAt: input.now,
            decidedByUserId: input.userId,
            clientDecisionId: input.clientDecisionId,
          },
        });
        if (updated.count !== 1) {
          throw new WorkflowRepairRepositoryError('REPAIR_CONFLICT');
        }
        const finalRow =
          await transaction.workflowRepairRequest.findUniqueOrThrow({
            where: { id: row.id },
            include: repairInclude,
          });
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildRepairDecidedInput({
            workspaceId: row.workspaceId,
            actor: { type: 'user', userId: input.userId },
            repairRequestId: row.id,
            workflowRunId: row.workflowRunId,
            decision:
              input.decision === 'RETRY_APPROVED'
                ? 'retry_approved'
                : 'aborted',
            resolvedAt: input.now,
          }),
        );
        await this.operationalAlerts?.resolve(transaction, {
          workspaceId: row.workspaceId, type: 'repair_required',
          sourceType: 'repair_request', sourceId: row.id,
          reason: input.decision === 'RETRY_APPROVED' ? 'retry_approved' : 'aborted',
          resolvedByUserId: input.userId,
        });
        return { idempotent: false, record: toRecord(finalRow) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async expire(
    repairRequestId: string,
    now: Date,
    terminateRun = true,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const request = await transaction.workflowRepairRequest.findFirst({
        where: {
          id: repairRequestId,
          status: WorkflowRepairRequestStatus.PENDING,
          expiresAt: { lte: now },
        },
        select: {
          id: true,
          workflowRunId: true,
          workspaceId: true,
          stepId: true,
          workflowRun: { select: { createdByUserId: true } },
        },
      });
      if (request === null) return;
      await transaction.workflowRepairRequest.update({
        where: { id: request.id },
        data: { status: WorkflowRepairRequestStatus.EXPIRED, resolvedAt: now },
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildRepairLifecycleInput({
          workspaceId: request.workspaceId,
          actor: { type: 'system', reason: 'automatic_expiry' },
          repairRequestId: request.id,
          workflowRunId: request.workflowRunId,
          reason: 'expired',
          resolvedAt: now,
        }),
      );
      await this.operationalAlerts?.resolve(transaction, {
        workspaceId: request.workspaceId, type: 'repair_required',
        sourceType: 'repair_request', sourceId: request.id, reason: 'expired',
      });
      if (!terminateRun) return;
      const timedOutRun = await transaction.workflowRun.updateMany({
        where: {
          id: request.workflowRunId,
          status: WorkflowRunStatus.WAITING_FOR_REPAIR,
        },
        data: {
          status: WorkflowRunStatus.TIMED_OUT,
          finishedAt: now,
          terminationCause: 'repair_expired',
          leaseTokenHash: null,
          leaseExpiresAt: null,
        },
      });
      if (timedOutRun.count === 1) {
        await this.operationalAlerts?.append(transaction, {
          schemaVersion: 1, workspaceId: request.workspaceId, type: 'run_timed_out',
          source: { type: 'workflow_run', id: request.workflowRunId },
          primaryEntity: { type: 'workflow_run', id: request.workflowRunId },
          relatedEntities: [{ type: 'repair_request', id: request.id }],
          template: { schemaVersion: 1, templateKey: 'run_timed_out.v1',
            workflowRunId: request.workflowRunId, timedOutAt: now.toISOString() },
          actionTarget: { schemaVersion: 1, kind: 'run', workspaceId: request.workspaceId,
            workflowRunId: request.workflowRunId },
          creatorUserId: request.workflowRun.createdByUserId,
        });
      }
      await transaction.workflowRunStep.updateMany({
        where: {
          workflowRunId: request.workflowRunId,
          sourceStepId: request.stepId,
          status: WorkflowRunStepStatus.WAITING_FOR_REPAIR,
        },
        data: {
          status: WorkflowRunStepStatus.TIMED_OUT,
          errorCode: 'RECOVERY_EXPIRED',
          finishedAt: now,
        },
      });
      await transaction.workflowRunStep.updateMany({
        where: {
          workflowRunId: request.workflowRunId,
          status: WorkflowRunStepStatus.PENDING,
        },
        data: {
          status: WorkflowRunStepStatus.SKIPPED,
          skippedReason: 'repair_expired',
          finishedAt: now,
        },
      });
    });
  }
}
