import {
  requireApprovalBinding,
  type ApprovalRequestStatus as ProtocolApprovalStatus,
  type RunnerApprovalRequestCreate,
} from '@tasktwin/workflow-approval';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import {
  createAuditSourceId,
  type AuditEventInput,
} from '@tasktwin/audit-trail';

import {
  OrganizationRole,
  Prisma,
  WorkflowApprovalRequestStatus,
  WorkflowApprovalRiskLevel,
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
import { WorkflowApprovalRepositoryError } from './workflow-approval-errors.js';
import type {
  WorkflowApprovalAccess,
  WorkflowApprovalDecisionResult,
  WorkflowApprovalRecord,
} from './workflow-approval-records.js';

const APPROVAL_EVENT_NAMESPACES = {
  requested: 'approval_requested',
  decided: 'approval_decided',
  lifecycle: 'approval_lifecycle',
} as const;

function buildApprovalRequestedInput(input: {
  workspaceId: string;
  actor: { type: 'runner'; runnerDeviceId: string };
  approvalRequestId: string;
  workflowRunId: string;
  approvalStepId: string;
  gatedStepId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requestedAt: Date;
  expiresAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'approval.requested',
    actor: input.actor,
    primaryEntity: { kind: 'approval_request', id: input.approvalRequestId },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.requestedAt,
    sourceId: createAuditSourceId(
      APPROVAL_EVENT_NAMESPACES.requested,
      [input.approvalRequestId],
      auditHasherForTrail,
    ),
    payload: {
      approvalRequestId: input.approvalRequestId,
      workflowRunId: input.workflowRunId,
      approvalStepId: input.approvalStepId,
      gatedStepId: input.gatedStepId,
      riskLevel: input.riskLevel,
      requestedAt: input.requestedAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
    },
  };
}

function buildApprovalDecidedInput(input: {
  workspaceId: string;
  actor: { type: 'user'; userId: string };
  approvalRequestId: string;
  workflowRunId: string;
  decision: 'approved' | 'rejected';
  resolvedAt: Date;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'approval.decided',
    actor: input.actor,
    primaryEntity: { kind: 'approval_request', id: input.approvalRequestId },
    relatedEntities: [{ kind: 'workflow_run', id: input.workflowRunId }],
    occurredAt: input.resolvedAt,
    sourceId: createAuditSourceId(
      APPROVAL_EVENT_NAMESPACES.decided,
      [input.approvalRequestId, input.decision, input.resolvedAt.toISOString()],
      auditHasherForTrail,
    ),
    payload: {
      approvalRequestId: input.approvalRequestId,
      workflowRunId: input.workflowRunId,
      decision: input.decision,
      decidedByUserId: input.actor.userId,
      resolvedAt: input.resolvedAt.toISOString(),
    },
  };
}

function buildApprovalLifecycleInput(input: {
  workspaceId: string;
  actor: { type: 'system'; reason: 'automatic_expiry' };
  approvalRequestId: string;
  workflowRunId: string;
  reason: 'expired' | 'cancelled' | 'invalidated';
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
      APPROVAL_EVENT_NAMESPACES.lifecycle,
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

const approvalInclude = {
  workflowRun: {
    include: {
      workflow: { select: { name: true } },
      workflowVersion: { select: { version: true, definition: true } },
    },
  },
} as const satisfies Prisma.WorkflowApprovalRequestInclude;

type ApprovalRow = Prisma.WorkflowApprovalRequestGetPayload<{
  include: typeof approvalInclude;
}>;

function toProtocolStatus(
  status: WorkflowApprovalRequestStatus,
): ProtocolApprovalStatus {
  return status;
}

function toRisk(level: 'low' | 'medium' | 'high' | 'critical') {
  return {
    low: WorkflowApprovalRiskLevel.LOW,
    medium: WorkflowApprovalRiskLevel.MEDIUM,
    high: WorkflowApprovalRiskLevel.HIGH,
    critical: WorkflowApprovalRiskLevel.CRITICAL,
  }[level];
}

function toRecord(row: ApprovalRow): WorkflowApprovalRecord {
  const workflow = WorkflowDefinitionSchema.parse(
    row.workflowRun.workflowVersion.definition,
  );
  const binding = requireApprovalBinding(workflow, row.approvalStepId);
  const approvalStep = workflow.steps[binding.approvalStepIndex];
  const gatedStep = workflow.steps[binding.gatedStepIndex];
  if (approvalStep?.type !== 'approval' || gatedStep === undefined) {
    throw new WorkflowApprovalRepositoryError('APPROVAL_INVALID');
  }
  return {
    id: row.id,
    workspaceId: row.workflowRun.workspaceId,
    workflowRunId: row.workflowRunId,
    workflowId: row.workflowRun.workflowId,
    workflowName: row.workflowRun.workflow.name,
    workflowVersion: row.workflowRun.workflowVersion.version,
    approvalStep: {
      id: approvalStep.id,
      name: approvalStep.name,
      message: approvalStep.message,
    },
    gatedStep: {
      id: gatedStep.id,
      name: gatedStep.name,
      type: gatedStep.type,
    },
    riskLevel: binding.riskLevel,
    status: toProtocolStatus(row.status),
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt,
  };
}

export class WorkflowApprovalRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditTrail: WorkspaceAuditTrailRepository = new WorkspaceAuditTrailRepository(
      prisma,
    ),
  ) {}

  async resolveApprovalAccess(
    userId: string,
    approvalRequestId: string,
  ): Promise<WorkflowApprovalAccess | null> {
    const row = await this.prisma.workflowApprovalRequest.findFirst({
      where: {
        id: approvalRequestId,
        workflowRun: {
          workspace: {
            organization: { members: { some: { userId } } },
          },
        },
      },
      select: {
        workflowRun: {
          select: {
            workspaceId: true,
            workspace: {
              select: {
                organization: {
                  select: {
                    id: true,
                    members: { where: { userId }, select: { role: true } },
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
          workspaceId: row.workflowRun.workspaceId,
          role: member.role,
        };
  }

  async createForRunner(input: {
    workflowRunId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    request: RunnerApprovalRequestCreate;
    now: Date;
  }): Promise<{ idempotent: boolean; record: WorkflowApprovalRecord }> {
    return this.prisma.$transaction(
      async (transaction) => {
        const run = await transaction.workflowRun.findUnique({
          where: { id: input.workflowRunId },
          include: {
            workflow: { select: { name: true } },
            workflowVersion: { select: { version: true, definition: true } },
          },
        });
        if (run === null) {
          throw new WorkflowApprovalRepositoryError('RUN_NOT_FOUND');
        }
        if (run.runnerDeviceId !== input.runnerDeviceId) {
          throw new WorkflowApprovalRepositoryError('RUNNER_MISMATCH');
        }
        if (
          run.leaseTokenHash !== input.leaseTokenHash ||
          run.leaseExpiresAt === null ||
          run.leaseExpiresAt <= input.now
        ) {
          throw new WorkflowApprovalRepositoryError('LEASE_INVALID');
        }
        if (
          run.status !== WorkflowRunStatus.RUNNING &&
          run.status !== WorkflowRunStatus.WAITING_FOR_APPROVAL
        ) {
          throw new WorkflowApprovalRepositoryError('APPROVAL_CONFLICT');
        }
        const workflow = WorkflowDefinitionSchema.parse(
          run.workflowVersion.definition,
        );
        const binding = requireApprovalBinding(
          workflow,
          input.request.approvalStepId,
        );
        const expiresAt = new Date(input.request.expiresAt);
        if (
          binding.gatedStepId !== input.request.gatedStepId ||
          expiresAt <= input.now ||
          expiresAt.getTime() > input.now.getTime() + binding.timeoutMs
        ) {
          throw new WorkflowApprovalRepositoryError('APPROVAL_INVALID');
        }
        const digest = createCanonicalJsonDigest(input.request);
        const existing = await transaction.workflowApprovalRequest.findFirst({
          where: {
            workflowRunId: run.id,
            OR: [
              { clientRequestId: input.request.clientRequestId },
              { approvalStepId: binding.approvalStepId },
            ],
          },
          include: approvalInclude,
        });
        if (existing !== null) {
          if (
            existing.clientRequestId !== input.request.clientRequestId ||
            existing.requestDigest !== digest
          ) {
            throw new WorkflowApprovalRepositoryError('APPROVAL_CONFLICT');
          }
          return { idempotent: true, record: toRecord(existing) };
        }
        const created = await transaction.workflowApprovalRequest.create({
          data: {
            workflowRunId: run.id,
            runnerDeviceId: input.runnerDeviceId,
            approvalStepId: binding.approvalStepId,
            gatedStepId: binding.gatedStepId,
            clientRequestId: input.request.clientRequestId,
            requestDigest: digest,
            riskLevel: toRisk(binding.riskLevel),
            requestedAt: input.now,
            expiresAt,
          },
          include: approvalInclude,
        });
        await transaction.workflowRun.update({
          where: { id: run.id },
          data: { status: WorkflowRunStatus.WAITING_FOR_APPROVAL },
        });
        await transaction.workflowRunStep.update({
          where: {
            workflowRunId_sourceStepId: {
              workflowRunId: run.id,
              sourceStepId: binding.approvalStepId,
            },
          },
          data: { status: WorkflowRunStepStatus.WAITING_FOR_APPROVAL },
        });
        await appendAuditEventTransactional(
          transaction,
          this.auditTrail,
          buildApprovalRequestedInput({
            workspaceId: run.workspaceId,
            actor: {
              type: 'runner',
              runnerDeviceId: input.runnerDeviceId,
            },
            approvalRequestId: created.id,
            workflowRunId: run.id,
            approvalStepId: binding.approvalStepId,
            gatedStepId: binding.gatedStepId,
            riskLevel: binding.riskLevel,
            requestedAt: input.now,
            expiresAt,
          }),
        );
        return { idempotent: false, record: toRecord(created) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getForRunner(input: {
    workflowRunId: string;
    approvalRequestId: string;
    runnerDeviceId: string;
    leaseTokenHash: string;
    now: Date;
  }): Promise<WorkflowApprovalRecord> {
    const authorized = await this.prisma.workflowApprovalRequest.findFirst({
      where: {
        id: input.approvalRequestId,
        workflowRunId: input.workflowRunId,
        runnerDeviceId: input.runnerDeviceId,
        workflowRun: { leaseTokenHash: input.leaseTokenHash },
      },
      select: { id: true },
    });
    if (authorized === null) {
      throw new WorkflowApprovalRepositoryError('APPROVAL_NOT_FOUND');
    }
    await this.expire(input.approvalRequestId, input.now, false);
    const row = await this.prisma.workflowApprovalRequest.findUnique({
      where: { id: authorized.id },
      include: approvalInclude,
    });
    if (row === null) {
      throw new WorkflowApprovalRepositoryError('APPROVAL_NOT_FOUND');
    }
    return toRecord(row);
  }

  async listForWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<{
    access: WorkflowApprovalAccess;
    records: WorkflowApprovalRecord[];
  }> {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId,
        organization: { workspaces: { some: { id: workspaceId } } },
      },
      select: { role: true, organizationId: true },
    });
    if (membership === null) {
      throw new WorkflowApprovalRepositoryError('APPROVAL_FORBIDDEN');
    }
    const expired = await this.prisma.workflowApprovalRequest.findMany({
      where: {
        workflowRun: { workspaceId },
        status: WorkflowApprovalRequestStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      select: { id: true },
      take: 1000,
    });
    for (const request of expired) {
      await this.expire(request.id, new Date());
    }
    const rows = await this.prisma.workflowApprovalRequest.findMany({
      where: { workflowRun: { workspaceId } },
      orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
      take: 1000,
      include: approvalInclude,
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

  async getForUser(
    userId: string,
    approvalRequestId: string,
  ): Promise<{
    access: WorkflowApprovalAccess;
    record: WorkflowApprovalRecord;
  }> {
    await this.expire(approvalRequestId, new Date());
    const access = await this.resolveApprovalAccess(userId, approvalRequestId);
    if (access === null) {
      throw new WorkflowApprovalRepositoryError('APPROVAL_NOT_FOUND');
    }
    const row = await this.prisma.workflowApprovalRequest.findUnique({
      where: { id: approvalRequestId },
      include: approvalInclude,
    });
    if (row === null) {
      throw new WorkflowApprovalRepositoryError('APPROVAL_NOT_FOUND');
    }
    return { access, record: toRecord(row) };
  }

  async decide(input: {
    userId: string;
    approvalRequestId: string;
    decision: 'APPROVED' | 'REJECTED';
    clientDecisionId: string;
    now: Date;
  }): Promise<WorkflowApprovalDecisionResult> {
    await this.expire(input.approvalRequestId, input.now);
    return this.prisma.$transaction(async (transaction) => {
      const reusedDecision =
        await transaction.workflowApprovalRequest.findUnique({
          where: { clientDecisionId: input.clientDecisionId },
          select: { id: true },
        });
      if (
        reusedDecision !== null &&
        reusedDecision.id !== input.approvalRequestId
      ) {
        throw new WorkflowApprovalRepositoryError('APPROVAL_CONFLICT');
      }
      const row = await transaction.workflowApprovalRequest.findUnique({
        where: { id: input.approvalRequestId },
        include: {
          ...approvalInclude,
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
        throw new WorkflowApprovalRepositoryError('APPROVAL_NOT_FOUND');
      }
      if (role !== OrganizationRole.OWNER && role !== OrganizationRole.ADMIN) {
        throw new WorkflowApprovalRepositoryError('APPROVAL_FORBIDDEN');
      }
      if (
        row.clientDecisionId === input.clientDecisionId &&
        row.status === input.decision
      ) {
        return { idempotent: true, record: toRecord(row) };
      }
      if (row.status !== WorkflowApprovalRequestStatus.PENDING) {
        throw new WorkflowApprovalRepositoryError(
          row.status === WorkflowApprovalRequestStatus.EXPIRED
            ? 'APPROVAL_EXPIRED'
            : 'APPROVAL_CONFLICT',
        );
      }
      if (row.expiresAt <= input.now) {
        throw new WorkflowApprovalRepositoryError('APPROVAL_EXPIRED');
      }
      const updated = await transaction.workflowApprovalRequest.updateMany({
        where: { id: row.id, status: WorkflowApprovalRequestStatus.PENDING },
        data: {
          status: input.decision,
          resolvedAt: input.now,
          decidedByUserId: input.userId,
          clientDecisionId: input.clientDecisionId,
        },
      });
      if (updated.count !== 1) {
        throw new WorkflowApprovalRepositoryError('APPROVAL_CONFLICT');
      }
      const finalRow =
        await transaction.workflowApprovalRequest.findUniqueOrThrow({
          where: { id: row.id },
          include: approvalInclude,
        });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildApprovalDecidedInput({
          workspaceId: row.workflowRun.workspaceId,
          actor: { type: 'user', userId: input.userId },
          approvalRequestId: row.id,
          workflowRunId: row.workflowRunId,
          decision:
            input.decision === 'APPROVED' ? 'approved' : 'rejected',
          resolvedAt: input.now,
        }),
      );
      return { idempotent: false, record: toRecord(finalRow) };
    });
  }

  private async expire(
    approvalRequestId: string,
    now: Date,
    terminateRun = true,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const request = await transaction.workflowApprovalRequest.findFirst({
        where: {
          id: approvalRequestId,
          status: WorkflowApprovalRequestStatus.PENDING,
          expiresAt: { lte: now },
        },
        select: {
          id: true,
          workflowRunId: true,
          approvalStepId: true,
          workflowRun: { select: { workspaceId: true } },
        },
      });
      if (request === null) return;
      await transaction.workflowApprovalRequest.update({
        where: { id: request.id },
        data: {
          status: WorkflowApprovalRequestStatus.EXPIRED,
          resolvedAt: now,
        },
      });
      await appendAuditEventTransactional(
        transaction,
        this.auditTrail,
        buildApprovalLifecycleInput({
          workspaceId: request.workflowRun.workspaceId,
          actor: { type: 'system', reason: 'automatic_expiry' },
          approvalRequestId: request.id,
          workflowRunId: request.workflowRunId,
          reason: 'expired',
          resolvedAt: now,
        }),
      );
      if (!terminateRun) return;
      await transaction.workflowRun.updateMany({
        where: {
          id: request.workflowRunId,
          status: WorkflowRunStatus.WAITING_FOR_APPROVAL,
        },
        data: {
          status: WorkflowRunStatus.TIMED_OUT,
          finishedAt: now,
          terminationCause: 'approval_expired',
          leaseTokenHash: null,
          leaseExpiresAt: null,
        },
      });
      await transaction.workflowRunStep.updateMany({
        where: {
          workflowRunId: request.workflowRunId,
          sourceStepId: request.approvalStepId,
          status: WorkflowRunStepStatus.WAITING_FOR_APPROVAL,
        },
        data: { status: WorkflowRunStepStatus.TIMED_OUT, finishedAt: now },
      });
      await transaction.workflowRunStep.updateMany({
        where: {
          workflowRunId: request.workflowRunId,
          status: WorkflowRunStepStatus.PENDING,
        },
        data: {
          status: WorkflowRunStepStatus.SKIPPED,
          finishedAt: now,
          skippedReason: 'approval_expired',
        },
      });
    });
  }

  async recordCancellationLifecycle(
    transaction: Prisma.TransactionClient,
    input: {
      approvalRequestId: string;
      workflowRunId: string;
      workspaceId: string;
      reason: 'cancelled' | 'invalidated';
      resolvedAt: Date;
    },
  ): Promise<void> {
    await appendAuditEventTransactional(
      transaction,
      this.auditTrail,
      buildApprovalLifecycleInput({
        workspaceId: input.workspaceId,
        actor: { type: 'system', reason: 'automatic_expiry' },
        approvalRequestId: input.approvalRequestId,
        workflowRunId: input.workflowRunId,
        reason: input.reason,
        resolvedAt: input.resolvedAt,
      }),
    );
  }
}
