import {
  MAX_REPAIR_TIMEOUT_MS,
  RecoveryModeSchema,
  decideRetry,
  isApprovalGatedStep,
  type RunnerRepairRequestCreate,
} from '@tasktwin/workflow-recovery';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';

import {
  OrganizationRole,
  Prisma,
  WorkflowExecutionEffectCertainty,
  WorkflowRepairRequestStatus,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { WorkflowRepairRepositoryError } from './workflow-repair-errors.js';
import type {
  WorkflowRepairAccess,
  WorkflowRepairDecisionResult,
  WorkflowRepairRecord,
} from './workflow-repair-records.js';

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
  constructor(private readonly prisma: PrismaClient) {}

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
      });
      if (request === null) return;
      await transaction.workflowRepairRequest.update({
        where: { id: request.id },
        data: { status: WorkflowRepairRequestStatus.EXPIRED, resolvedAt: now },
      });
      if (!terminateRun) return;
      await transaction.workflowRun.updateMany({
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
