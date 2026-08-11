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
  WorkflowRepairRequestStatus,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  WorkflowRunStepAttemptStatus,
  WorkflowExecutionEffectCertainty,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { RunnerRepositoryError } from './runner-errors.js';
import type {
  RunnerAuthenticationRecord,
  RunnerDeviceListRecord,
  RunnerDeviceRecord,
  RunnerHeartbeatPersistenceResult,
  RunnerOrganizationAccess,
  RunnerPairingRecord,
  RunnerPollingResult,
} from './runner-records.js';
import type { OperationalAlertTransactionAppender } from '../operational-alerts/operational-alert-port.js';
import type { LocalSecretStoreStatus } from '@tasktwin/local-secret-store';
import {
  RunnerRuntimeMetadataSchema,
  type RunnerRuntimeReport,
} from '@tasktwin/runner-service-runtime';
import { appendAuditEventTransactional } from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import type { RunnerSoftwareIdentity } from '@tasktwin/runner-release';
import {
  deriveRunnerCompliance,
  observeAssignmentVersion,
  stageHasConverged,
} from '@tasktwin/runner-rollout';
import {
  evaluatePersistedRunnerCompatibility,
  toPersistedRunnerSoftwareIdentity,
  toRunnerReleasePlatform,
} from './runner-software-compatibility.js';

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
  runProtocolVersion?: number | null;
  workflowSchemaVersion?: number | null;
  localStateSchemaVersion?: number | null;
  installationId: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  capabilities: string[];
  runtimeMode?: string | null;
  autonomyLevel?: string | null;
  serviceStatus?: string | null;
  secretUnlockMode?: string | null;
  restartResilient?: boolean | null;
  runtimeMetadataRevision?: number;
  desiredRelease?: { version: string } | null;
  desiredRolloutAssignment?: { status: string } | null;
  actualReleaseStatus?: 'available' | 'deprecated' | 'blocked' | null;
  secretInventory?: {
    storeStatus: string;
    vaultRevision: number;
    lastSynchronizedAt: Date;
    _count: { entries: number };
    entries: Array<{ alias: string; secretVersionId: string }>;
  } | null;
}): RunnerDeviceRecord {
  const softwareIdentity = toPersistedRunnerSoftwareIdentity({
    runnerVersion: row.runnerVersion,
    platform: row.platform,
    architecture: row.architecture,
    runProtocolVersion: row.runProtocolVersion ?? null,
    workflowSchemaVersion: row.workflowSchemaVersion ?? null,
    localStateSchemaVersion: row.localStateSchemaVersion ?? null,
  });
  const compatibility = evaluatePersistedRunnerCompatibility({
    runnerVersion: row.runnerVersion,
    platform: row.platform,
    architecture: row.architecture,
    runProtocolVersion: row.runProtocolVersion ?? null,
    workflowSchemaVersion: row.workflowSchemaVersion ?? null,
    localStateSchemaVersion: row.localStateSchemaVersion ?? null,
  });
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
    softwareIdentity,
    capabilities: row.capabilities as RunnerCapability[],
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    runtime:
      row.runtimeMode === null ||
      row.runtimeMode === undefined ||
      row.autonomyLevel === null ||
      row.autonomyLevel === undefined ||
      row.serviceStatus === null ||
      row.serviceStatus === undefined ||
      row.secretUnlockMode === null ||
      row.secretUnlockMode === undefined ||
      row.restartResilient === null ||
      row.restartResilient === undefined
        ? null
        : RunnerRuntimeMetadataSchema.parse({
            schemaVersion: 1,
            runtimeMode: row.runtimeMode,
            autonomyLevel: row.autonomyLevel,
            serviceStatus: row.serviceStatus,
            secretUnlockMode: row.secretUnlockMode,
            restartResilient: row.restartResilient,
            runtimeMetadataRevision: row.runtimeMetadataRevision ?? 0,
          }),
    desiredVersion: row.desiredRelease?.version ?? null,
    complianceStatus: deriveRunnerCompliance({
      actualIdentity: softwareIdentity,
      compatibility,
      actualReleaseStatus: row.actualReleaseStatus ?? null,
      desiredVersion: row.desiredRelease?.version ?? null,
      assignmentStatus:
        (row.desiredRolloutAssignment?.status as
          | 'pending'
          | 'target_assigned'
          | 'converged'
          | 'rolled_back'
          | 'failed'
          | 'cancelled'
          | undefined) ?? null,
      localMaintenanceObserved: row.serviceStatus === 'draining',
    }),
    localSecretStore:
      row.secretInventory === null || row.secretInventory === undefined
        ? null
        : {
            status:
              row.secretInventory.storeStatus.toLowerCase() as LocalSecretStoreStatus,
            vaultRevision: row.secretInventory.vaultRevision,
            configuredSecretCount: row.secretInventory._count.entries,
            lastSynchronizedAt: row.secretInventory.lastSynchronizedAt,
            aliases: [...row.secretInventory.entries].sort((left, right) =>
              left.alias.localeCompare(right.alias),
            ),
          },
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
  private readonly auditTrail: WorkspaceAuditTrailRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly operationalAlerts?: OperationalAlertTransactionAppender,
  ) {
    this.auditTrail = new WorkspaceAuditTrailRepository(prisma);
  }

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
        runProtocolVersion: true,
        workflowSchemaVersion: true,
        localStateSchemaVersion: true,
        installationId: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
        capabilities: true,
        runtimeMode: true,
        autonomyLevel: true,
        serviceStatus: true,
        secretUnlockMode: true,
        restartResilient: true,
        runtimeMetadataRevision: true,
        desiredRelease: { select: { version: true } },
        desiredRolloutAssignment: { select: { status: true } },
        secretInventory: {
          select: {
            storeStatus: true,
            vaultRevision: true,
            lastSynchronizedAt: true,
            _count: { select: { entries: true } },
            entries: { select: { alias: true, secretVersionId: true } },
          },
        },
      },
    });
    const actualReleases =
      this.prisma.runnerRelease === undefined
        ? []
        : await this.prisma.runnerRelease.findMany({
            where: {
              product: 'tasktwin-runner',
              version: {
                in: [...new Set(devices.map((device) => device.runnerVersion))],
              },
            },
            select: { version: true, status: true },
          });
    const actualStatusByVersion = new Map(
      actualReleases.map((release) => [release.version, release.status]),
    );
    return {
      workspaceId,
      access,
      devices: devices.map((device) =>
        toDeviceRecord({
          ...device,
          actualReleaseStatus:
            actualStatusByVersion.get(device.runnerVersion) ?? null,
        }),
      ),
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
    softwareIdentity?: RunnerSoftwareIdentity;
    capabilities: RunnerCapability[];
    runtime?: RunnerRuntimeReport;
    now: Date;
  }): Promise<RunnerHeartbeatPersistenceResult> {
    return this.runSerializable(async (transaction) => {
      const device = await transaction.runnerDevice.findUnique({
        where: { id: input.runnerDeviceId },
        select: {
          revokedAt: true,
          workspaceId: true,
          runnerVersion: true,
          platform: true,
          architecture: true,
          runProtocolVersion: true,
          workflowSchemaVersion: true,
          localStateSchemaVersion: true,
          softwareMetadataRevision: true,
          runtimeMode: true,
          autonomyLevel: true,
          serviceStatus: true,
          secretUnlockMode: true,
          restartResilient: true,
          runtimeMetadataRevision: true,
          desiredRelease: { select: { id: true, version: true } },
          desiredRolloutAssignment: {
            select: {
              id: true,
              status: true,
              baselineVersion: true,
              stage: {
                select: {
                  id: true,
                  stageNumber: true,
                  rollout: {
                    select: {
                      id: true,
                      workspaceId: true,
                      targetRelease: { select: { version: true } },
                    },
                  },
                },
              },
            },
          },
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
      if (
        input.softwareIdentity !== undefined &&
        (input.softwareIdentity.version !== input.runnerVersion ||
          input.softwareIdentity.platform !==
            toRunnerReleasePlatform(device.platform) ||
          input.softwareIdentity.architecture !== device.architecture)
      ) {
        throw new RunnerRepositoryError('RUNNER_SOFTWARE_IDENTITY_CONFLICT');
      }
      const databaseNow = (
        await transaction.$queryRaw<Array<{ now: Date }>>`
        SELECT clock_timestamp() AS "now"
      `
      )[0]?.now;
      if (databaseNow === undefined)
        throw new RunnerRepositoryError('RUNNER_REVOKED');
      const runtimeChanged =
        input.runtime !== undefined &&
        (device.runtimeMode !== input.runtime.runtimeMode ||
          device.autonomyLevel !== input.runtime.autonomyLevel ||
          device.serviceStatus !== input.runtime.serviceStatus ||
          device.secretUnlockMode !== input.runtime.secretUnlockMode ||
          device.restartResilient !== input.runtime.restartResilient);
      const nextRuntimeRevision = runtimeChanged
        ? device.runtimeMetadataRevision + 1
        : device.runtimeMetadataRevision;
      const reportedRunProtocolVersion =
        input.softwareIdentity?.runnerProtocolVersion ?? null;
      const reportedWorkflowSchemaVersion =
        input.softwareIdentity?.workflowSchemaVersion ?? null;
      const reportedLocalStateSchemaVersion =
        input.softwareIdentity?.localStateSchemaVersion ?? null;
      const softwareChanged =
        device.runnerVersion !== input.runnerVersion ||
        device.runProtocolVersion !== reportedRunProtocolVersion ||
        device.workflowSchemaVersion !== reportedWorkflowSchemaVersion ||
        device.localStateSchemaVersion !== reportedLocalStateSchemaVersion;
      const versionChanged = device.runnerVersion !== input.runnerVersion;
      const nextSoftwareRevision = softwareChanged
        ? device.softwareMetadataRevision + 1
        : device.softwareMetadataRevision;
      await transaction.runnerDevice.update({
        where: { id: input.runnerDeviceId },
        data: {
          lastSeenAt: databaseNow,
          runnerVersion: input.runnerVersion,
          runProtocolVersion: reportedRunProtocolVersion,
          workflowSchemaVersion: reportedWorkflowSchemaVersion,
          localStateSchemaVersion: reportedLocalStateSchemaVersion,
          softwareMetadataRevision: nextSoftwareRevision,
          ...(softwareChanged
            ? { softwareMetadataUpdatedAt: databaseNow }
            : {}),
          capabilities: input.capabilities,
          capabilitiesUpdatedAt: databaseNow,
          ...(input.runtime === undefined
            ? {}
            : {
                runtimeMode: input.runtime.runtimeMode,
                autonomyLevel: input.runtime.autonomyLevel,
                serviceStatus: input.runtime.serviceStatus,
                secretUnlockMode: input.runtime.secretUnlockMode,
                restartResilient: input.runtime.restartResilient,
                runtimeMetadataRevision: nextRuntimeRevision,
                ...(runtimeChanged
                  ? { runtimeMetadataUpdatedAt: databaseNow }
                  : {}),
              }),
        },
      });
      await transaction.runnerCredential.update({
        where: { id: input.credentialId },
        data: { lastUsedAt: databaseNow },
      });
      if (versionChanged) {
        await appendAuditEventTransactional(transaction, this.auditTrail, {
          workspaceId: device.workspaceId,
          eventType: 'runner.software_version.changed',
          actor: { type: 'runner', runnerDeviceId: input.runnerDeviceId },
          primaryEntity: { kind: 'runner_device', id: input.runnerDeviceId },
          occurredAt: databaseNow,
          sourceId: `runner-software:${input.runnerDeviceId}:${nextSoftwareRevision}`,
          payload: {
            runnerDeviceId: input.runnerDeviceId,
            previousVersion: device.runnerVersion,
            newVersion: input.runnerVersion,
            runnerProtocolVersion: reportedRunProtocolVersion,
            localStateSchemaVersion: reportedLocalStateSchemaVersion,
          },
        });
      }
      if (runtimeChanged && input.runtime !== undefined) {
        if (
          device.runtimeMode !== input.runtime.runtimeMode ||
          device.autonomyLevel !== input.runtime.autonomyLevel ||
          device.serviceStatus !== input.runtime.serviceStatus
        ) {
          await appendAuditEventTransactional(transaction, this.auditTrail, {
            workspaceId: device.workspaceId,
            eventType: 'runner.runtime_mode.changed',
            actor: { type: 'runner', runnerDeviceId: input.runnerDeviceId },
            primaryEntity: { kind: 'runner_device', id: input.runnerDeviceId },
            occurredAt: databaseNow,
            sourceId: `runner-runtime:${input.runnerDeviceId}:${nextRuntimeRevision}`,
            payload: {
              runnerDeviceId: input.runnerDeviceId,
              previousRuntimeMode: device.runtimeMode,
              runtimeMode: input.runtime.runtimeMode,
              previousAutonomyLevel: device.autonomyLevel,
              autonomyLevel: input.runtime.autonomyLevel,
              serviceStatus: input.runtime.serviceStatus,
            },
          });
        }
        if (device.secretUnlockMode !== input.runtime.secretUnlockMode) {
          await appendAuditEventTransactional(transaction, this.auditTrail, {
            workspaceId: device.workspaceId,
            eventType: 'runner.secret_protector.changed',
            actor: { type: 'runner', runnerDeviceId: input.runnerDeviceId },
            primaryEntity: { kind: 'runner_device', id: input.runnerDeviceId },
            occurredAt: databaseNow,
            sourceId: `runner-secret-protector:${input.runnerDeviceId}:${nextRuntimeRevision}`,
            payload: {
              runnerDeviceId: input.runnerDeviceId,
              previousUnlockMode: device.secretUnlockMode,
              unlockMode: input.runtime.secretUnlockMode,
            },
          });
        }
      }
      const assignmentStatus = await this.observeRolloutAssignment({
        transaction,
        assignment: device.desiredRolloutAssignment ?? null,
        runnerDeviceId: input.runnerDeviceId,
        actualVersion: input.runnerVersion,
        observedAt: databaseNow,
      });
      const runtime =
        input.runtime === undefined
          ? null
          : RunnerRuntimeMetadataSchema.parse({
              ...input.runtime,
              runtimeMetadataRevision: nextRuntimeRevision,
            });
      const compatibility = evaluatePersistedRunnerCompatibility({
        runnerVersion: input.runnerVersion,
        platform: device.platform,
        architecture: device.architecture,
        runProtocolVersion: reportedRunProtocolVersion,
        workflowSchemaVersion: reportedWorkflowSchemaVersion,
        localStateSchemaVersion: reportedLocalStateSchemaVersion,
      });
      const actualRelease =
        transaction.runnerRelease === undefined
          ? null
          : await transaction.runnerRelease.findUnique({
              where: {
                product_version: {
                  product: 'tasktwin-runner',
                  version: input.runnerVersion,
                },
              },
              select: { status: true },
            });
      const desiredVersion = device.desiredRelease?.version ?? null;
      return {
        runtime,
        compatibility,
        desiredVersion,
        complianceStatus: deriveRunnerCompliance({
          actualIdentity: toPersistedRunnerSoftwareIdentity({
            runnerVersion: input.runnerVersion,
            platform: device.platform,
            architecture: device.architecture,
            runProtocolVersion: reportedRunProtocolVersion,
            workflowSchemaVersion: reportedWorkflowSchemaVersion,
            localStateSchemaVersion: reportedLocalStateSchemaVersion,
          }),
          compatibility,
          actualReleaseStatus: actualRelease?.status ?? null,
          desiredVersion,
          assignmentStatus,
          localMaintenanceObserved: input.runtime?.serviceStatus === 'draining',
        }),
      };
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
          runProtocolVersion: true,
          workflowSchemaVersion: true,
          localStateSchemaVersion: true,
          installationId: true,
          lastSeenAt: true,
          revokedAt: true,
          createdAt: true,
          capabilities: true,
          runtimeMode: true,
          autonomyLevel: true,
          serviceStatus: true,
          secretUnlockMode: true,
          restartResilient: true,
          runtimeMetadataRevision: true,
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
          runProtocolVersion: true,
          workflowSchemaVersion: true,
          localStateSchemaVersion: true,
          installationId: true,
          lastSeenAt: true,
          revokedAt: true,
          createdAt: true,
          capabilities: true,
          runtimeMode: true,
          autonomyLevel: true,
          serviceStatus: true,
          secretUnlockMode: true,
          restartResilient: true,
          runtimeMetadataRevision: true,
        },
      });
      const invalidatedApprovals =
        await transaction.workflowApprovalRequest.findMany({
          where: {
            runnerDeviceId,
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
          runnerDeviceId,
          status: WorkflowApprovalRequestStatus.PENDING,
        },
        data: {
          status: WorkflowApprovalRequestStatus.INVALIDATED,
          resolvedAt: now,
        },
      });
      for (const approval of invalidatedApprovals) {
        await this.operationalAlerts?.resolve(transaction, {
          workspaceId: approval.workflowRun.workspaceId,
          type: 'approval_required',
          sourceType: 'approval_request',
          sourceId: approval.id,
          reason: 'invalidated',
        });
      }
      const invalidatedRepairs =
        await transaction.workflowRepairRequest.findMany({
          where: {
            runnerDeviceId,
            status: WorkflowRepairRequestStatus.PENDING,
          },
          select: { id: true, workspaceId: true },
        });
      await transaction.workflowRepairRequest.updateMany({
        where: {
          runnerDeviceId,
          status: WorkflowRepairRequestStatus.PENDING,
        },
        data: {
          status: WorkflowRepairRequestStatus.INVALIDATED,
          resolvedAt: now,
        },
      });
      for (const repair of invalidatedRepairs) {
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
          workflowRun: { runnerDeviceId },
          status: WorkflowRunStepAttemptStatus.RUNNING,
        },
        data: {
          status: WorkflowRunStepAttemptStatus.INTERRUPTED,
          safeErrorCode: 'RUNNER_REVOKED',
          effectCertainty: WorkflowExecutionEffectCertainty.UNKNOWN,
          finishedAt: now,
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
              WorkflowRunStatus.WAITING_FOR_REPAIR,
              WorkflowRunStatus.CANCEL_REQUESTED,
            ],
          },
        },
        select: { id: true, workspaceId: true, createdByUserId: true },
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
                WorkflowRunStepStatus.WAITING_FOR_REPAIR,
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
        for (const run of activeRuns) {
          await this.operationalAlerts?.append(transaction, {
            schemaVersion: 1,
            workspaceId: run.workspaceId,
            type: 'run_interrupted',
            source: { type: 'workflow_run', id: run.id },
            primaryEntity: { type: 'workflow_run', id: run.id },
            relatedEntities: [],
            template: {
              schemaVersion: 1,
              templateKey: 'run_interrupted.v1',
              workflowRunId: run.id,
              interruptedAt: now.toISOString(),
            },
            actionTarget: {
              schemaVersion: 1,
              kind: 'run',
              workspaceId: run.workspaceId,
              workflowRunId: run.id,
            },
            creatorUserId: run.createdByUserId,
          });
        }
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

  private async observeRolloutAssignment(input: {
    transaction: Prisma.TransactionClient;
    assignment: {
      id: string;
      status:
        | 'pending'
        | 'target_assigned'
        | 'converged'
        | 'rolled_back'
        | 'failed'
        | 'cancelled';
      baselineVersion: string | null;
      stage: {
        id: string;
        stageNumber: number;
        rollout: {
          id: string;
          workspaceId: string;
          targetRelease: { version: string };
        };
      };
    } | null;
    runnerDeviceId: string;
    actualVersion: string;
    observedAt: Date;
  }): Promise<
    | 'pending'
    | 'target_assigned'
    | 'converged'
    | 'rolled_back'
    | 'failed'
    | 'cancelled'
    | null
  > {
    const assignment = input.assignment;
    if (assignment === null) return null;
    const observation = observeAssignmentVersion({
      assignmentStatus: assignment.status,
      targetVersion: assignment.stage.rollout.targetRelease.version,
      baselineVersion: assignment.baselineVersion,
      actualVersion: input.actualVersion,
    });
    await input.transaction.runnerReleaseRolloutAssignment.update({
      where: { id: assignment.id },
      data: {
        lastObservedVersion: input.actualVersion,
        lastObservedAt: input.observedAt,
        ...(observation.outcome === 'converged'
          ? { status: 'converged', convergedAt: input.observedAt }
          : observation.outcome === 'rolled_back'
            ? { status: 'rolled_back', rolledBackAt: input.observedAt }
            : observation.outcome === 'failed'
              ? { status: 'failed', failedAt: input.observedAt }
              : {}),
      },
    });
    if (observation.outcome === 'converged') {
      await appendAuditEventTransactional(input.transaction, this.auditTrail, {
        workspaceId: assignment.stage.rollout.workspaceId,
        eventType: 'runner.rollout.assignment.converged',
        actor: { type: 'runner', runnerDeviceId: input.runnerDeviceId },
        primaryEntity: {
          kind: 'runner_release_rollout_assignment',
          id: assignment.id,
        },
        relatedEntities: [
          {
            kind: 'runner_release_rollout',
            id: assignment.stage.rollout.id,
          },
          { kind: 'runner_device', id: input.runnerDeviceId },
        ],
        occurredAt: input.observedAt,
        sourceId: `runner-rollout-converged:${assignment.id}`,
        payload: {
          rolloutId: assignment.stage.rollout.id,
          stageId: assignment.stage.id,
          assignmentId: assignment.id,
          runnerDeviceId: input.runnerDeviceId,
          stageNumber: assignment.stage.stageNumber,
          observedAt: input.observedAt,
        },
      });
      const statuses =
        await input.transaction.runnerReleaseRolloutAssignment.findMany({
          where: { stageId: assignment.stage.id },
          select: { status: true },
        });
      if (stageHasConverged(statuses.map((value) => value.status))) {
        await input.transaction.runnerReleaseRolloutStage.update({
          where: { id: assignment.stage.id },
          data: { status: 'completed', completedAt: input.observedAt },
        });
        const remainingStages =
          await input.transaction.runnerReleaseRolloutStage.count({
            where: {
              rolloutId: assignment.stage.rollout.id,
              status: { not: 'completed' },
            },
          });
        if (remainingStages === 0) {
          await input.transaction.runnerReleaseRollout.update({
            where: { id: assignment.stage.rollout.id },
            data: { status: 'completed', completedAt: input.observedAt },
          });
          const completedAssignments =
            await input.transaction.runnerReleaseRolloutAssignment.findMany({
              where: { rolloutId: assignment.stage.rollout.id },
              select: { id: true, runnerDeviceId: true },
            });
          for (const completed of completedAssignments) {
            await input.transaction.runnerDevice.updateMany({
              where: {
                id: completed.runnerDeviceId,
                desiredRolloutAssignmentId: completed.id,
              },
              data: {
                desiredRolloutAssignmentId: null,
                desiredAssignedAt: null,
              },
            });
          }
        }
      }
    }
    if (
      observation.outcome === 'rolled_back' ||
      observation.outcome === 'failed'
    ) {
      const reason =
        observation.outcome === 'rolled_back'
          ? 'assignment_rolled_back'
          : 'unexpected_version_after_convergence';
      await input.transaction.runnerReleaseRolloutStage.update({
        where: { id: assignment.stage.id },
        data: {
          status: 'failed_review',
          reviewReason: reason,
          failedReviewAt: input.observedAt,
        },
      });
      await input.transaction.runnerReleaseRollout.update({
        where: { id: assignment.stage.rollout.id },
        data: {
          status: 'paused',
          reviewReason: reason,
          pausedAt: input.observedAt,
        },
      });
      if (observation.outcome === 'rolled_back') {
        await appendAuditEventTransactional(
          input.transaction,
          this.auditTrail,
          {
            workspaceId: assignment.stage.rollout.workspaceId,
            eventType: 'runner.rollout.assignment.rolled_back',
            actor: { type: 'runner', runnerDeviceId: input.runnerDeviceId },
            primaryEntity: {
              kind: 'runner_release_rollout_assignment',
              id: assignment.id,
            },
            relatedEntities: [
              {
                kind: 'runner_release_rollout',
                id: assignment.stage.rollout.id,
              },
              { kind: 'runner_device', id: input.runnerDeviceId },
            ],
            occurredAt: input.observedAt,
            sourceId: `runner-rollout-rolled-back:${assignment.id}`,
            payload: {
              rolloutId: assignment.stage.rollout.id,
              stageId: assignment.stage.id,
              assignmentId: assignment.id,
              runnerDeviceId: input.runnerDeviceId,
              stageNumber: assignment.stage.stageNumber,
              observedAt: input.observedAt,
            },
          },
        );
        await this.operationalAlerts?.append(input.transaction, {
          schemaVersion: 1,
          workspaceId: assignment.stage.rollout.workspaceId,
          type: 'runner_rollout_requires_review',
          source: {
            type: 'runner_release_rollout_assignment',
            id: assignment.id,
          },
          primaryEntity: {
            type: 'runner_release_rollout',
            id: assignment.stage.rollout.id,
          },
          relatedEntities: [
            {
              type: 'runner_release_rollout_assignment',
              id: assignment.id,
            },
          ],
          template: {
            schemaVersion: 1,
            templateKey: 'runner_rollout_requires_review.v1',
            rolloutId: assignment.stage.rollout.id,
            reason: 'assignment_rolled_back',
            observedAt: input.observedAt.toISOString(),
          },
          actionTarget: {
            schemaVersion: 1,
            kind: 'runner_rollout',
            workspaceId: assignment.stage.rollout.workspaceId,
            rolloutId: assignment.stage.rollout.id,
          },
        });
      }
    }
    return observation.assignmentStatus;
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
