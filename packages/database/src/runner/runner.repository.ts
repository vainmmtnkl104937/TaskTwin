import {
  CREDENTIAL_DELIVERY_WINDOW_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
  POLL_SLOW_DOWN_INCREMENT_SECONDS,
  type RunnerCapability,
  type RunnerDeviceMetadata,
} from '@tasktwin/runner-protocol';

import {
  OrganizationRole,
  Prisma,
  WorkflowApprovalRequestStatus,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { RunnerRepositoryError } from './runner-errors.js';
import type {
  RunnerAuthenticationRecord,
  RunnerDeviceListRecord,
  RunnerDeviceRecord,
  RunnerOrganizationAccess,
  RunnerPairingRecord,
  RunnerPollingResult,
} from './runner-records.js';

const MANAGER_ROLES = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;
const SERIALIZATION_RETRY_COUNT = 3;

const pairingSelect = {
  id: true,
  status: true,
  displayName: true,
  platform: true,
  architecture: true,
  runnerVersion: true,
  installationId: true,
  workspaceId: true,
  expiresAt: true,
  pollIntervalSeconds: true,
  lastPolledAt: true,
  credentialDeliveryExpiresAt: true,
} as const satisfies Prisma.RunnerPairingSessionSelect;

function toPairingRecord(
  row: Prisma.RunnerPairingSessionGetPayload<{ select: typeof pairingSelect }>,
): RunnerPairingRecord {
  return {
    id: row.id,
    status: row.status,
    metadata: {
      displayName: row.displayName,
      platform: row.platform as RunnerDeviceMetadata['platform'],
      architecture: row.architecture as RunnerDeviceMetadata['architecture'],
      runnerVersion: row.runnerVersion,
      installationId: row.installationId,
    },
    workspaceId: row.workspaceId,
    expiresAt: row.expiresAt,
    pollIntervalSeconds: row.pollIntervalSeconds,
  };
}

function toDeviceRecord(row: {
  id: string;
  workspaceId: string;
  displayName: string;
  platform: string;
  architecture: string;
  runnerVersion: string;
  installationId: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  capabilities: string[];
}): RunnerDeviceRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    metadata: {
      displayName: row.displayName,
      platform: row.platform as RunnerDeviceMetadata['platform'],
      architecture: row.architecture as RunnerDeviceMetadata['architecture'],
      runnerVersion: row.runnerVersion,
      installationId: row.installationId,
    },
    capabilities: row.capabilities as RunnerCapability[],
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

function isSerializationError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2028')
  );
}

function isUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export class RunnerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPairingSession(input: {
    id: string;
    deviceCodeHash: string;
    userCodeDigest: string;
    metadata: RunnerDeviceMetadata;
    expiresAt: Date;
    pollIntervalSeconds: number;
  }): Promise<RunnerPairingRecord> {
    try {
      const row = await this.prisma.runnerPairingSession.create({
        data: {
          id: input.id,
          deviceCodeHash: input.deviceCodeHash,
          userCodeDigest: input.userCodeDigest,
          displayName: input.metadata.displayName,
          platform: input.metadata.platform,
          architecture: input.metadata.architecture,
          runnerVersion: input.metadata.runnerVersion,
          installationId: input.metadata.installationId,
          expiresAt: input.expiresAt,
          pollIntervalSeconds: input.pollIntervalSeconds,
        },
        select: pairingSelect,
      });
      return toPairingRecord(row);
    } catch (error: unknown) {
      if (isUniqueError(error)) {
        throw new RunnerRepositoryError('PAIRING_CODE_COLLISION');
      }
      throw error;
    }
  }

  async findPairingIdByDeviceCodeHash(
    deviceCodeHash: string,
  ): Promise<string | null> {
    const row = await this.prisma.runnerPairingSession.findUnique({
      where: { deviceCodeHash },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  inspectPairing(
    actorUserId: string,
    userCodeDigest: string,
    now: Date,
  ): Promise<RunnerPairingRecord | null> {
    return this.runSerializable(async (transaction) => {
      const row = await this.lockPairingByUserCode(transaction, userCodeDigest);
      if (row === null) {
        return null;
      }
      const current = await this.expireIfRequired(transaction, row, now);
      if (
        current.workspaceId !== null &&
        (await this.resolveWorkspaceAccessWithClient(
          transaction,
          actorUserId,
          current.workspaceId,
        )) === null
      ) {
        return null;
      }
      return toPairingRecord(current);
    });
  }

  approvePairing(
    actorUserId: string,
    workspaceId: string,
    userCodeDigest: string,
    now: Date,
  ): Promise<RunnerPairingRecord> {
    return this.runSerializable(async (transaction) => {
      await this.requireManager(
        transaction,
        actorUserId,
        workspaceId,
        'WORKSPACE_NOT_FOUND',
      );
      const row = await this.lockPairingByUserCode(transaction, userCodeDigest);
      if (row === null) {
        throw new RunnerRepositoryError('PAIRING_UNAVAILABLE');
      }
      const current = await this.expireIfRequired(transaction, row, now);
      if (current.status !== 'PENDING') {
        throw new RunnerRepositoryError('PAIRING_CONFLICT');
      }
      const updated = await transaction.runnerPairingSession.update({
        where: { id: current.id },
        data: {
          status: 'APPROVED',
          workspaceId,
          approvedById: actorUserId,
          approvedAt: now,
        },
        select: pairingSelect,
      });
      return toPairingRecord(updated);
    });
  }

  denyPairing(
    actorUserId: string,
    workspaceId: string,
    userCodeDigest: string,
    now: Date,
  ): Promise<RunnerPairingRecord> {
    return this.runSerializable(async (transaction) => {
      await this.requireManager(
        transaction,
        actorUserId,
        workspaceId,
        'WORKSPACE_NOT_FOUND',
      );
      const row = await this.lockPairingByUserCode(transaction, userCodeDigest);
      if (row === null) {
        throw new RunnerRepositoryError('PAIRING_UNAVAILABLE');
      }
      const current = await this.expireIfRequired(transaction, row, now);
      if (current.status !== 'PENDING') {
        throw new RunnerRepositoryError('PAIRING_CONFLICT');
      }
      const updated = await transaction.runnerPairingSession.update({
        where: { id: current.id },
        data: {
          status: 'DENIED',
          workspaceId,
          deniedById: actorUserId,
          deniedAt: now,
        },
        select: pairingSelect,
      });
      return toPairingRecord(updated);
    });
  }

  pollPairing(input: {
    deviceCodeHash: string;
    runnerDeviceId: string;
    credentialId: string;
    credentialHash: string;
    now: Date;
  }): Promise<RunnerPollingResult> {
    return this.runSerializable(async (transaction) => {
      const row = await this.lockPairingByDeviceCode(
        transaction,
        input.deviceCodeHash,
      );
      if (row === null) {
        return { status: 'expired' };
      }
      const current = await this.expireIfRequired(transaction, row, input.now);
      if (current.status === 'DENIED') {
        return { status: 'access_denied' };
      }
      if (current.status === 'EXPIRED') {
        return { status: 'expired' };
      }
      if (current.status === 'CONSUMED') {
        if (
          current.credentialDeliveryExpiresAt === null ||
          current.credentialDeliveryExpiresAt.getTime() < input.now.getTime()
        ) {
          return { status: 'expired' };
        }
        const device = await transaction.runnerDevice.findUnique({
          where: { pairingSessionId: current.id },
          select: { id: true, workspaceId: true },
        });
        return device === null
          ? { status: 'expired' }
          : {
              status: 'paired',
              runnerDeviceId: device.id,
              workspaceId: device.workspaceId,
              intervalSeconds: current.pollIntervalSeconds,
            };
      }

      if (
        current.lastPolledAt !== null &&
        input.now.getTime() - current.lastPolledAt.getTime() <
          current.pollIntervalSeconds * 1_000
      ) {
        const intervalSeconds = Math.min(
          MAX_POLL_INTERVAL_SECONDS,
          current.pollIntervalSeconds + POLL_SLOW_DOWN_INCREMENT_SECONDS,
        );
        await transaction.runnerPairingSession.update({
          where: { id: current.id },
          data: {
            lastPolledAt: input.now,
            pollIntervalSeconds: intervalSeconds,
          },
        });
        return { status: 'slow_down', intervalSeconds };
      }

      await transaction.runnerPairingSession.update({
        where: { id: current.id },
        data: { lastPolledAt: input.now },
      });
      if (current.status === 'PENDING') {
        return {
          status: 'authorization_pending',
          intervalSeconds: current.pollIntervalSeconds,
        };
      }
      if (current.workspaceId === null) {
        throw new RunnerRepositoryError('PAIRING_CONFLICT');
      }

      try {
        await transaction.runnerDevice.create({
          data: {
            id: input.runnerDeviceId,
            workspaceId: current.workspaceId,
            pairingSessionId: current.id,
            installationId: current.installationId,
            displayName: current.displayName,
            platform: current.platform,
            architecture: current.architecture,
            runnerVersion: current.runnerVersion,
            credential: {
              create: {
                id: input.credentialId,
                credentialHash: input.credentialHash,
              },
            },
          },
        });
      } catch (error: unknown) {
        if (isUniqueError(error)) {
          throw new RunnerRepositoryError('PAIRING_CONFLICT');
        }
        throw error;
      }
      await transaction.runnerPairingSession.update({
        where: { id: current.id },
        data: {
          status: 'CONSUMED',
          consumedAt: input.now,
          credentialDeliveryExpiresAt: new Date(
            input.now.getTime() + CREDENTIAL_DELIVERY_WINDOW_SECONDS * 1_000,
          ),
        },
      });
      return {
        status: 'paired',
        runnerDeviceId: input.runnerDeviceId,
        workspaceId: current.workspaceId,
        intervalSeconds: current.pollIntervalSeconds,
      };
    });
  }

  async resolveRunnerDeviceAccess(
    userId: string,
    runnerDeviceId: string,
  ): Promise<RunnerOrganizationAccess | null> {
    const device = await this.prisma.runnerDevice.findFirst({
      where: {
        id: runnerDeviceId,
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
    const membership = device?.workspace.organization.members[0];
    return device === null || device === undefined || membership === undefined
      ? null
      : {
          organizationId: device.workspace.organization.id,
          userId,
          role: membership.role,
        };
  }

  async listRunnerDevices(
    actorUserId: string,
    workspaceId: string,
  ): Promise<RunnerDeviceListRecord | null> {
    const access = await this.resolveWorkspaceAccessWithClient(
      this.prisma,
      actorUserId,
      workspaceId,
    );
    if (access === null) {
      return null;
    }
    const devices = await this.prisma.runnerDevice.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        workspaceId: true,
        displayName: true,
        platform: true,
        architecture: true,
        runnerVersion: true,
        installationId: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
        capabilities: true,
      },
    });
    return {
      workspaceId,
      access,
      devices: devices.map(toDeviceRecord),
    };
  }

  async findRunnerAuthentication(
    runnerDeviceId: string,
  ): Promise<RunnerAuthenticationRecord | null> {
    const row = await this.prisma.runnerDevice.findUnique({
      where: { id: runnerDeviceId },
      select: {
        id: true,
        workspaceId: true,
        revokedAt: true,
        credential: {
          select: {
            id: true,
            credentialHash: true,
            revokedAt: true,
          },
        },
      },
    });
    return row?.credential === null || row?.credential === undefined
      ? null
      : {
          runnerDeviceId: row.id,
          workspaceId: row.workspaceId,
          credentialId: row.credential.id,
          credentialHash: row.credential.credentialHash,
          deviceRevokedAt: row.revokedAt,
          credentialRevokedAt: row.credential.revokedAt,
        };
  }

  heartbeat(input: {
    runnerDeviceId: string;
    credentialId: string;
    runnerVersion: string;
    capabilities: RunnerCapability[];
    now: Date;
  }): Promise<void> {
    return this.runSerializable(async (transaction) => {
      const device = await transaction.runnerDevice.findUnique({
        where: { id: input.runnerDeviceId },
        select: {
          revokedAt: true,
          credential: {
            select: { id: true, revokedAt: true },
          },
        },
      });
      if (
        device === null ||
        device.revokedAt !== null ||
        device.credential?.id !== input.credentialId ||
        device.credential.revokedAt !== null
      ) {
        throw new RunnerRepositoryError('RUNNER_REVOKED');
      }
      await transaction.runnerDevice.update({
        where: { id: input.runnerDeviceId },
        data: {
          lastSeenAt: input.now,
          runnerVersion: input.runnerVersion,
          capabilities: input.capabilities,
          capabilitiesUpdatedAt: input.now,
        },
      });
      await transaction.runnerCredential.update({
        where: { id: input.credentialId },
        data: { lastUsedAt: input.now },
      });
    });
  }

  revokeRunnerDevice(
    actorUserId: string,
    runnerDeviceId: string,
    now: Date,
  ): Promise<RunnerDeviceRecord> {
    return this.runSerializable(async (transaction) => {
      const device = await transaction.runnerDevice.findUnique({
        where: { id: runnerDeviceId },
        select: {
          id: true,
          workspaceId: true,
          displayName: true,
          platform: true,
          architecture: true,
          runnerVersion: true,
          installationId: true,
          lastSeenAt: true,
          revokedAt: true,
          createdAt: true,
          capabilities: true,
        },
      });
      if (device === null) {
        throw new RunnerRepositoryError('RUNNER_DEVICE_NOT_FOUND');
      }
      await this.requireManager(
        transaction,
        actorUserId,
        device.workspaceId,
        'RUNNER_DEVICE_NOT_FOUND',
      );
      const revoked = await transaction.runnerDevice.update({
        where: { id: runnerDeviceId },
        data: {
          revokedAt: device.revokedAt ?? now,
          ...(device.revokedAt === null
            ? { revokedBy: { connect: { id: actorUserId } } }
            : {}),
          credential: {
            update: { revokedAt: device.revokedAt ?? now },
          },
        },
        select: {
          id: true,
          workspaceId: true,
          displayName: true,
          platform: true,
          architecture: true,
          runnerVersion: true,
          installationId: true,
          lastSeenAt: true,
          revokedAt: true,
          createdAt: true,
          capabilities: true,
        },
      });
      await transaction.workflowApprovalRequest.updateMany({
        where: {
          runnerDeviceId,
          status: WorkflowApprovalRequestStatus.PENDING,
        },
        data: {
          status: WorkflowApprovalRequestStatus.INVALIDATED,
          resolvedAt: now,
        },
      });
      const activeRuns = await transaction.workflowRun.findMany({
        where: {
          runnerDeviceId,
          status: {
            in: [
              WorkflowRunStatus.CLAIMED,
              WorkflowRunStatus.RUNNING,
              WorkflowRunStatus.WAITING_FOR_APPROVAL,
              WorkflowRunStatus.CANCEL_REQUESTED,
            ],
          },
        },
        select: { id: true },
      });
      const activeRunIds = activeRuns.map((run) => run.id);
      if (activeRunIds.length > 0) {
        await transaction.workflowRunStep.updateMany({
          where: {
            workflowRunId: { in: activeRunIds },
            status: {
              in: [
                WorkflowRunStepStatus.RUNNING,
                WorkflowRunStepStatus.WAITING_FOR_APPROVAL,
              ],
            },
          },
          data: {
            status: WorkflowRunStepStatus.INTERRUPTED,
            errorCode: 'RUNNER_REVOKED',
            finishedAt: now,
          },
        });
        await transaction.workflowRunStep.updateMany({
          where: {
            workflowRunId: { in: activeRunIds },
            status: WorkflowRunStepStatus.PENDING,
          },
          data: {
            status: WorkflowRunStepStatus.SKIPPED,
            skippedReason: 'run_interrupted',
            finishedAt: now,
          },
        });
        await transaction.workflowRun.updateMany({
          where: { id: { in: activeRunIds } },
          data: {
            status: WorkflowRunStatus.INTERRUPTED,
            terminationCause: 'runner_revoked',
            finishedAt: now,
            leaseTokenHash: null,
            leaseExpiresAt: null,
          },
        });
      }
      return toDeviceRecord(revoked);
    });
  }

  private async expireIfRequired(
    transaction: Prisma.TransactionClient,
    row: Prisma.RunnerPairingSessionGetPayload<{
      select: typeof pairingSelect;
    }>,
    now: Date,
  ): Promise<typeof row> {
    if (
      (row.status === 'PENDING' || row.status === 'APPROVED') &&
      row.expiresAt.getTime() <= now.getTime()
    ) {
      return transaction.runnerPairingSession.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
        select: pairingSelect,
      });
    }
    return row;
  }

  private async lockPairingByUserCode(
    transaction: Prisma.TransactionClient,
    digest: string,
  ) {
    const ids = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "runner_pairing_sessions"
      WHERE "user_code_digest" = ${digest}
      FOR UPDATE
    `;
    return ids[0] === undefined
      ? null
      : transaction.runnerPairingSession.findUnique({
          where: { id: ids[0].id },
          select: pairingSelect,
        });
  }

  private async lockPairingByDeviceCode(
    transaction: Prisma.TransactionClient,
    digest: string,
  ) {
    const ids = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "runner_pairing_sessions"
      WHERE "device_code_hash" = ${digest}
      FOR UPDATE
    `;
    return ids[0] === undefined
      ? null
      : transaction.runnerPairingSession.findUnique({
          where: { id: ids[0].id },
          select: pairingSelect,
        });
  }

  private async resolveWorkspaceAccessWithClient(
    client: Prisma.TransactionClient | PrismaClient,
    userId: string,
    workspaceId: string,
  ): Promise<RunnerOrganizationAccess | null> {
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

  private async requireManager(
    transaction: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    missingCode: 'WORKSPACE_NOT_FOUND' | 'RUNNER_DEVICE_NOT_FOUND',
  ): Promise<void> {
    const access = await this.resolveWorkspaceAccessWithClient(
      transaction,
      userId,
      workspaceId,
    );
    if (access === null) {
      throw new RunnerRepositoryError(missingCode);
    }
    if (
      !MANAGER_ROLES.includes(access.role as (typeof MANAGER_ROLES)[number])
    ) {
      throw new RunnerRepositoryError('RUNNER_FORBIDDEN');
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
            throw new RunnerRepositoryError('SERIALIZATION_FAILURE');
          }
          throw error;
        }
      }
    }
    throw new RunnerRepositoryError('SERIALIZATION_FAILURE');
  }
}
