import {
  assertReleaseSupportsRunner,
  assertRolloutTransition,
  assertStageMayActivate,
  validateRolloutPlan,
  type RolloutPlan,
} from '@tasktwin/runner-rollout';
import { ReleaseManifestSchema } from '@tasktwin/runner-release';

import {
  OrganizationRole,
  Prisma,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { appendAuditEventTransactional } from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import { toRunnerReleasePlatform } from '../runner/runner-software-compatibility.js';
import { RunnerRolloutRepositoryError } from './runner-rollout-errors.js';
import type {
  RunnerRolloutAccess,
  RunnerRolloutRecord,
} from './runner-rollout-records.js';

const MANAGER_ROLES = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;
const SERIALIZATION_RETRY_COUNT = 3;

function isSerializationError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2028')
  );
}

const rolloutInclude = {
  targetRelease: {
    select: { id: true, product: true, version: true, status: true },
  },
  stages: {
    orderBy: { stageNumber: 'asc' as const },
    include: {
      assignments: {
        orderBy: { runnerDeviceId: 'asc' as const },
        include: { runnerDevice: { select: { displayName: true } } },
      },
    },
  },
} as const satisfies Prisma.RunnerReleaseRolloutInclude;

type RolloutRow = Prisma.RunnerReleaseRolloutGetPayload<{
  include: typeof rolloutInclude;
}>;

function toRecord(row: RolloutRow): RunnerRolloutRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    clientRolloutId: row.clientRolloutId,
    status: row.status,
    reviewReason: row.reviewReason,
    targetRelease: row.targetRelease,
    createdByUserId: row.createdByUserId,
    activatedAt: row.activatedAt,
    pausedAt: row.pausedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    stages: row.stages.map((stage) => ({
      id: stage.id,
      stageNumber: stage.stageNumber,
      status: stage.status,
      reviewReason: stage.reviewReason,
      activatedAt: stage.activatedAt,
      completedAt: stage.completedAt,
      assignments: stage.assignments.map((assignment) => ({
        id: assignment.id,
        runnerDeviceId: assignment.runnerDeviceId,
        runnerDisplayName: assignment.runnerDevice.displayName,
        status: assignment.status,
        baselineVersion: assignment.baselineVersion,
        lastObservedVersion: assignment.lastObservedVersion,
        assignedAt: assignment.assignedAt,
        convergedAt: assignment.convergedAt,
        rolledBackAt: assignment.rolledBackAt,
      })),
    })),
  };
}

export class RunnerRolloutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveRolloutAccess(
    userId: string,
    rolloutId: string,
  ): Promise<RunnerRolloutAccess | null> {
    const row = await this.prisma.runnerReleaseRollout.findUnique({
      where: { id: rolloutId },
      select: {
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
    const member = row?.workspace.organization.members[0];
    return row === null || row === undefined || member === undefined
      ? null
      : {
          organizationId: row.workspace.organizationId,
          userId,
          role: member.role,
        };
  }

  async list(
    actorUserId: string,
    workspaceId: string,
    input: {
      limit: number;
      cursor?: { createdAt: Date; id: string };
    } = { limit: 50 },
  ): Promise<{
    access: RunnerRolloutAccess;
    rollouts: RunnerRolloutRecord[];
    nextCursor: { createdAt: Date; id: string } | null;
  } | null> {
    const access = await this.resolveWorkspaceAccess(actorUserId, workspaceId);
    if (access === null) return null;
    const rows = await this.prisma.runnerReleaseRollout.findMany({
      where: {
        workspaceId,
        ...(input.cursor === undefined
          ? {}
          : {
              OR: [
                { createdAt: { lt: input.cursor.createdAt } },
                {
                  createdAt: input.cursor.createdAt,
                  id: { gt: input.cursor.id },
                },
              ],
            }),
      },
      include: rolloutInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      access,
      rollouts: page.map(toRecord),
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : null,
    };
  }

  async get(
    actorUserId: string,
    rolloutId: string,
  ): Promise<{
    access: RunnerRolloutAccess;
    rollout: RunnerRolloutRecord;
  } | null> {
    const access = await this.resolveRolloutAccess(actorUserId, rolloutId);
    if (access === null) return null;
    const row = await this.prisma.runnerReleaseRollout.findUnique({
      where: { id: rolloutId },
      include: rolloutInclude,
    });
    return row === null ? null : { access, rollout: toRecord(row) };
  }

  async create(input: {
    actorUserId: string;
    clientRolloutId: string;
    requestDigest: string;
    plan: RolloutPlan;
  }): Promise<{ rollout: RunnerRolloutRecord; idempotent: boolean }> {
    const plan = validateRolloutPlan(input.plan);
    return this.runSerializable(async (tx) => {
      await this.requireManager(tx, input.actorUserId, plan.workspaceId);
      const existing = await tx.runnerReleaseRollout.findUnique({
        where: {
          workspaceId_clientRolloutId: {
            workspaceId: plan.workspaceId,
            clientRolloutId: input.clientRolloutId,
          },
        },
        include: rolloutInclude,
      });
      if (existing !== null) {
        if (existing.requestDigest !== input.requestDigest) {
          throw new RunnerRolloutRepositoryError(
            'ROLLOUT_IDEMPOTENCY_CONFLICT',
          );
        }
        return { rollout: toRecord(existing), idempotent: true };
      }
      const release = await tx.runnerRelease.findUnique({
        where: { id: plan.targetReleaseId },
      });
      if (release?.status !== 'available') {
        throw new RunnerRolloutRepositoryError('RELEASE_NOT_AVAILABLE');
      }
      const runnerIds = plan.stages.flatMap((stage) => stage.runnerDeviceIds);
      const runners = await tx.runnerDevice.findMany({
        where: { id: { in: runnerIds } },
        select: { id: true, workspaceId: true },
      });
      if (
        runners.length !== runnerIds.length ||
        runners.some((runner) => runner.workspaceId !== plan.workspaceId)
      ) {
        throw new RunnerRolloutRepositoryError('RUNNER_WORKSPACE_MISMATCH');
      }
      const now = new Date();
      const rollout = await tx.runnerReleaseRollout.create({
        data: {
          workspaceId: plan.workspaceId,
          targetReleaseId: plan.targetReleaseId,
          clientRolloutId: input.clientRolloutId,
          requestDigest: input.requestDigest,
          createdByUserId: input.actorUserId,
        },
      });
      for (const definition of plan.stages) {
        const stage = await tx.runnerReleaseRolloutStage.create({
          data: {
            rolloutId: rollout.id,
            stageNumber: definition.stageNumber,
          },
        });
        await tx.runnerReleaseRolloutAssignment.createMany({
          data: definition.runnerDeviceIds.map((runnerDeviceId) => ({
            rolloutId: rollout.id,
            stageId: stage.id,
            runnerDeviceId,
          })),
        });
      }
      const created = await tx.runnerReleaseRollout.findUniqueOrThrow({
        where: { id: rollout.id },
        include: rolloutInclude,
      });
      await appendAuditEventTransactional(
        tx,
        new WorkspaceAuditTrailRepository(tx),
        {
          workspaceId: plan.workspaceId,
          eventType: 'runner.rollout.created',
          actor: { type: 'user', userId: input.actorUserId },
          primaryEntity: {
            kind: 'runner_release_rollout',
            id: created.id,
          },
          relatedEntities: [
            { kind: 'runner_release', id: plan.targetReleaseId },
          ],
          occurredAt: now,
          sourceId: `runner-rollout-created:${created.id}`,
          payload: {
            rolloutId: created.id,
            targetReleaseId: plan.targetReleaseId,
            stageCount: plan.stages.length,
            assignmentCount: runnerIds.length,
          },
        },
      );
      return { rollout: toRecord(created), idempotent: false };
    });
  }

  activate(
    actorUserId: string,
    rolloutId: string,
  ): Promise<RunnerRolloutRecord> {
    return this.changeRolloutState({
      actorUserId,
      rolloutId,
      action: 'activate',
    });
  }

  pause(actorUserId: string, rolloutId: string): Promise<RunnerRolloutRecord> {
    return this.changeRolloutState({ actorUserId, rolloutId, action: 'pause' });
  }

  cancel(actorUserId: string, rolloutId: string): Promise<RunnerRolloutRecord> {
    return this.changeRolloutState({
      actorUserId,
      rolloutId,
      action: 'cancel',
    });
  }

  async activateStage(input: {
    actorUserId: string;
    rolloutId: string;
    stageNumber: number;
  }): Promise<RunnerRolloutRecord> {
    return this.runSerializable(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "runner_release_rollouts"
        WHERE "id" = ${input.rolloutId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new RunnerRolloutRepositoryError('ROLLOUT_NOT_FOUND');
      }
      const rollout = await tx.runnerReleaseRollout.findUnique({
        where: { id: input.rolloutId },
        include: {
          targetRelease: true,
          stages: {
            orderBy: { stageNumber: 'asc' },
            include: { assignments: { include: { runnerDevice: true } } },
          },
        },
      });
      if (rollout === null) {
        throw new RunnerRolloutRepositoryError('ROLLOUT_NOT_FOUND');
      }
      await this.requireManager(tx, input.actorUserId, rollout.workspaceId);
      const stage = rollout.stages.find(
        (candidate) => candidate.stageNumber === input.stageNumber,
      );
      if (stage === undefined) {
        throw new RunnerRolloutRepositoryError('STAGE_NOT_FOUND');
      }
      if (stage.status === 'active' || stage.status === 'completed') {
        const current = await tx.runnerReleaseRollout.findUniqueOrThrow({
          where: { id: rollout.id },
          include: rolloutInclude,
        });
        return toRecord(current);
      }
      const previous = rollout.stages.find(
        (candidate) => candidate.stageNumber === input.stageNumber - 1,
      );
      assertStageMayActivate({
        rolloutStatus: rollout.status,
        targetStatus: rollout.targetRelease.status,
        stageNumber: stage.stageNumber,
        previousStageStatus: previous?.status ?? null,
      });
      const manifest = ReleaseManifestSchema.parse(
        rollout.targetRelease.manifest,
      );
      for (const assignment of stage.assignments) {
        const runner = assignment.runnerDevice;
        if (runner.workspaceId !== rollout.workspaceId) {
          throw new RunnerRolloutRepositoryError('RUNNER_WORKSPACE_MISMATCH');
        }
        if (runner.revokedAt !== null) {
          throw new RunnerRolloutRepositoryError('RUNNER_REVOKED');
        }
        const releasePlatform = toRunnerReleasePlatform(runner.platform);
        if (releasePlatform === null) {
          throw new RunnerRolloutRepositoryError(
            'RUNNER_PLATFORM_INCOMPATIBLE',
          );
        }
        try {
          assertReleaseSupportsRunner({
            release: {
              id: rollout.targetRelease.id,
              product: rollout.targetRelease.product,
              version: rollout.targetRelease.version,
              status: rollout.targetRelease.status,
              targets: manifest.artifacts.map((artifact) => ({
                platform: artifact.platform,
                architecture: artifact.architecture,
              })),
            },
            runner: {
              platform: releasePlatform,
              architecture: runner.architecture,
            },
          });
        } catch {
          throw new RunnerRolloutRepositoryError(
            'RUNNER_PLATFORM_INCOMPATIBLE',
          );
        }
        if (
          runner.desiredRolloutAssignmentId !== null &&
          runner.desiredRolloutAssignmentId !== assignment.id
        ) {
          throw new RunnerRolloutRepositoryError(
            'RUNNER_ACTIVE_ROLLOUT_CONFLICT',
          );
        }
      }
      const now = new Date();
      for (const assignment of stage.assignments) {
        await tx.runnerDevice.update({
          where: { id: assignment.runnerDeviceId },
          data: {
            desiredReleaseId: rollout.targetReleaseId,
            desiredRolloutAssignmentId: assignment.id,
            desiredAssignedAt: now,
          },
        });
        await tx.runnerReleaseRolloutAssignment.update({
          where: { id: assignment.id },
          data: {
            status: 'target_assigned',
            baselineVersion: assignment.runnerDevice.runnerVersion,
            lastObservedVersion: assignment.runnerDevice.runnerVersion,
            lastObservedAt: now,
            assignedAt: now,
          },
        });
      }
      await tx.runnerReleaseRolloutStage.update({
        where: { id: stage.id },
        data: {
          status: 'active',
          activatedByUserId: input.actorUserId,
          activatedAt: now,
        },
      });
      await appendAuditEventTransactional(
        tx,
        new WorkspaceAuditTrailRepository(tx),
        {
          workspaceId: rollout.workspaceId,
          eventType: 'runner.rollout.stage.activated',
          actor: { type: 'user', userId: input.actorUserId },
          primaryEntity: {
            kind: 'runner_release_rollout_stage',
            id: stage.id,
          },
          relatedEntities: [
            { kind: 'runner_release_rollout', id: rollout.id },
            { kind: 'runner_release', id: rollout.targetReleaseId },
          ],
          occurredAt: now,
          sourceId: `runner-rollout-stage-activated:${stage.id}`,
          payload: {
            rolloutId: rollout.id,
            stageId: stage.id,
            stageNumber: stage.stageNumber,
            targetReleaseId: rollout.targetReleaseId,
            assignmentCount: stage.assignments.length,
          },
        },
      );
      const updated = await tx.runnerReleaseRollout.findUniqueOrThrow({
        where: { id: rollout.id },
        include: rolloutInclude,
      });
      return toRecord(updated);
    });
  }

  private async changeRolloutState(input: {
    actorUserId: string;
    rolloutId: string;
    action: 'activate' | 'pause' | 'cancel';
  }): Promise<RunnerRolloutRecord> {
    return this.runSerializable(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "runner_release_rollouts"
        WHERE "id" = ${input.rolloutId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new RunnerRolloutRepositoryError('ROLLOUT_NOT_FOUND');
      }
      const rollout = await tx.runnerReleaseRollout.findUnique({
        where: { id: input.rolloutId },
        include: { targetRelease: true },
      });
      if (rollout === null) {
        throw new RunnerRolloutRepositoryError('ROLLOUT_NOT_FOUND');
      }
      await this.requireManager(tx, input.actorUserId, rollout.workspaceId);
      const next =
        input.action === 'activate'
          ? 'active'
          : input.action === 'pause'
            ? 'paused'
            : 'cancelled';
      if (rollout.status === next) {
        const current = await tx.runnerReleaseRollout.findUniqueOrThrow({
          where: { id: rollout.id },
          include: rolloutInclude,
        });
        return toRecord(current);
      }
      if (
        input.action === 'activate' &&
        (rollout.targetRelease.status !== 'available' ||
          rollout.reviewReason !== null)
      ) {
        throw new RunnerRolloutRepositoryError('RELEASE_NOT_AVAILABLE');
      }
      try {
        assertRolloutTransition(rollout.status, next);
      } catch {
        throw new RunnerRolloutRepositoryError('INVALID_STATE_TRANSITION');
      }
      const now = new Date();
      if (input.action === 'cancel') {
        const rolloutAssignments =
          await tx.runnerReleaseRolloutAssignment.findMany({
            where: {
              rolloutId: rollout.id,
            },
            select: { id: true, runnerDeviceId: true, status: true },
          });
        const cancellable = rolloutAssignments.filter(
          (assignment) =>
            assignment.status === 'pending' ||
            assignment.status === 'target_assigned',
        );
        for (const assignment of cancellable) {
          await tx.runnerDevice.updateMany({
            where: {
              id: assignment.runnerDeviceId,
              desiredRolloutAssignmentId: assignment.id,
            },
            data: {
              desiredReleaseId: null,
              desiredRolloutAssignmentId: null,
              desiredAssignedAt: null,
            },
          });
        }
        for (const assignment of rolloutAssignments) {
          if (
            assignment.status === 'pending' ||
            assignment.status === 'target_assigned'
          ) {
            continue;
          }
          await tx.runnerDevice.updateMany({
            where: {
              id: assignment.runnerDeviceId,
              desiredRolloutAssignmentId: assignment.id,
            },
            data: {
              desiredRolloutAssignmentId: null,
              desiredAssignedAt: null,
              ...(assignment.status === 'converged'
                ? {}
                : { desiredReleaseId: null }),
            },
          });
        }
        await tx.runnerReleaseRolloutAssignment.updateMany({
          where: {
            rolloutId: rollout.id,
            status: { in: ['pending', 'target_assigned'] },
          },
          data: { status: 'cancelled', cancelledAt: now },
        });
        await tx.runnerReleaseRolloutStage.updateMany({
          where: {
            rolloutId: rollout.id,
            status: { in: ['pending', 'active', 'failed_review'] },
          },
          data: { status: 'cancelled', cancelledAt: now },
        });
      }
      const updated = await tx.runnerReleaseRollout.update({
        where: { id: rollout.id },
        data:
          input.action === 'activate'
            ? {
                status: 'active',
                activatedByUserId: input.actorUserId,
                activatedAt: rollout.activatedAt ?? now,
                pausedAt: null,
                pausedByUserId: null,
              }
            : input.action === 'pause'
              ? {
                  status: 'paused',
                  pausedByUserId: input.actorUserId,
                  pausedAt: now,
                }
              : {
                  status: 'cancelled',
                  cancelledByUserId: input.actorUserId,
                  cancelledAt: now,
                },
        include: rolloutInclude,
      });
      const eventType = `runner.rollout.${
        input.action === 'cancel' ? 'cancelled' : `${input.action}d`
      }` as
        | 'runner.rollout.activated'
        | 'runner.rollout.paused'
        | 'runner.rollout.cancelled';
      await appendAuditEventTransactional(
        tx,
        new WorkspaceAuditTrailRepository(tx),
        {
          workspaceId: rollout.workspaceId,
          eventType,
          actor: { type: 'user', userId: input.actorUserId },
          primaryEntity: {
            kind: 'runner_release_rollout',
            id: rollout.id,
          },
          occurredAt: now,
          sourceId: `${eventType}:${rollout.id}:${now.toISOString()}`,
          payload: {
            rolloutId: rollout.id,
            status: next,
            ...(input.action === 'activate' ? {} : { reason: 'manual' }),
            changedAt: now,
          },
        },
      );
      return toRecord(updated);
    });
  }

  private async resolveWorkspaceAccess(
    userId: string,
    workspaceId: string,
  ): Promise<RunnerRolloutAccess | null> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
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
    });
    const member = workspace?.organization.members[0];
    return workspace === null || workspace === undefined || member === undefined
      ? null
      : { organizationId: workspace.organizationId, userId, role: member.role };
  }

  private async requireManager(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const member = await tx.organizationMember.findFirst({
      where: {
        userId,
        role: { in: [...MANAGER_ROLES] },
        organization: { workspaces: { some: { id: workspaceId } } },
      },
      select: { userId: true },
    });
    if (member === null) {
      throw new RunnerRolloutRepositoryError('ROLLOUT_FORBIDDEN');
    }
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
            throw new RunnerRolloutRepositoryError('SERIALIZATION_FAILURE');
          }
          throw error;
        }
      }
    }
    throw new RunnerRolloutRepositoryError('SERIALIZATION_FAILURE');
  }
}
