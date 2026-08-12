import {
  AuditActorSchema,
  AuditEntityRefSchema,
  AuditEventTypeSchema,
  GENESIS_PREVIOUS_HASH,
  RelatedAuditEntitiesSchema,
  verifyAuditEventChain,
  type StoredAuditEvent,
} from '@tasktwin/audit-trail';

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { auditHasherForTrail } from '../audit-trail/audit-appender.repository.js';
import {
  createRunnerReleaseSystemAuditHash,
  RUNNER_RELEASE_SYSTEM_AUDIT_SCOPE,
} from '../runner-release/system-audit-hash.js';

const AUDIT_BATCH_SIZE = 1_000;

export interface RestoredDatabaseVerificationResult {
  valid: true;
  completedMigrationCount: number;
  workspaceAuditChains: number;
  workspaceAuditEvents: number;
  systemAuditChains: number;
  systemAuditEvents: number;
  expiredActiveWorkflowRuns: number;
  pendingNotificationOutboxMessages: number;
  runnerDevices: number;
  runnerReleases: number;
  runnerRollouts: number;
}

export interface RestoredDatabaseVerificationOptions {
  requireRecoveredRuns?: boolean;
}

export class RestoredDatabaseVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RestoredDatabaseVerificationError';
  }
}

function workspaceEventToStoredEvent(row: {
  id: string;
  workspaceId: string;
  sequence: number;
  schemaVersion: number;
  eventType: string;
  actorType: string;
  actorId: string;
  actorReason: string | null;
  primaryEntityKind: string;
  primaryEntityId: string;
  relatedEntities: Prisma.JsonValue;
  occurredAt: Date;
  sourceId: string;
  correlationId: string | null;
  payload: Prisma.JsonValue;
  payloadDigest: string;
  previousHash: string;
  eventHash: string;
  createdAt: Date;
}): StoredAuditEvent {
  if (row.schemaVersion !== 1) {
    throw new RestoredDatabaseVerificationError(
      'RESTORE_WORKSPACE_AUDIT_SCHEMA_UNSUPPORTED',
    );
  }
  const actor = AuditActorSchema.parse(
    row.actorType === 'user'
      ? { type: 'user', userId: row.actorId }
      : row.actorType === 'runner'
        ? { type: 'runner', runnerDeviceId: row.actorId }
        : { type: 'system', reason: row.actorReason },
  );
  return {
    id: row.id,
    schemaVersion: row.schemaVersion as 1,
    workspaceId: row.workspaceId,
    sequence: row.sequence,
    eventType: AuditEventTypeSchema.parse(row.eventType),
    actor,
    primaryEntity: AuditEntityRefSchema.parse({
      kind: row.primaryEntityKind,
      id: row.primaryEntityId,
    }),
    relatedEntities: RelatedAuditEntitiesSchema.parse(row.relatedEntities),
    occurredAt: row.occurredAt.toISOString(),
    sourceId: row.sourceId,
    ...(row.correlationId === null ? {} : { correlationId: row.correlationId }),
    payload: row.payload,
    payloadDigest: row.payloadDigest,
    previousHash: row.previousHash,
    eventHash: row.eventHash,
    createdAt: row.createdAt.toISOString(),
  };
}

async function verifyWorkspaceAuditChains(
  prisma: PrismaClient,
): Promise<{ chains: number; events: number }> {
  const heads = await prisma.workspaceAuditChainHead.findMany({
    orderBy: { workspaceId: 'asc' },
  });
  const workspacesWithoutHead = await prisma.workspace.count({
    where: { auditChainHead: null },
  });
  if (workspacesWithoutHead !== 0) {
    throw new RestoredDatabaseVerificationError(
      'RESTORE_WORKSPACE_AUDIT_HEAD_MISSING',
    );
  }

  let eventCount = 0;
  for (const head of heads) {
    let expectedSequence = 1;
    let expectedPreviousHash = GENESIS_PREVIOUS_HASH;
    for (;;) {
      const rows = await prisma.workspaceAuditEvent.findMany({
        where: {
          workspaceId: head.workspaceId,
          sequence: { gte: expectedSequence },
        },
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
        take: AUDIT_BATCH_SIZE,
      });
      if (rows.length === 0) break;
      let events: StoredAuditEvent[];
      try {
        events = rows.map(workspaceEventToStoredEvent);
      } catch {
        throw new RestoredDatabaseVerificationError(
          'RESTORE_WORKSPACE_AUDIT_EVENT_INVALID',
        );
      }
      const verification = verifyAuditEventChain(auditHasherForTrail, events, {
        expectedFirstSequence: expectedSequence,
        expectedPreviousHash,
        storedHeadHash: head.lastEventHash,
        requireHeadMatch: false,
      });
      if (!verification.valid) {
        throw new RestoredDatabaseVerificationError(
          `RESTORE_WORKSPACE_AUDIT_${verification.failureCode ?? 'INVALID'}`,
        );
      }
      eventCount += events.length;
      expectedSequence += events.length;
      expectedPreviousHash = events.at(-1)?.eventHash ?? expectedPreviousHash;
      if (rows.length < AUDIT_BATCH_SIZE) break;
    }
    if (
      head.lastSequence !== expectedSequence - 1 ||
      head.lastEventHash !== expectedPreviousHash
    ) {
      throw new RestoredDatabaseVerificationError(
        'RESTORE_WORKSPACE_AUDIT_HEAD_MISMATCH',
      );
    }
  }
  return { chains: heads.length, events: eventCount };
}

async function verifySystemAuditChains(
  prisma: PrismaClient,
): Promise<{ chains: number; events: number }> {
  const heads = await prisma.systemAuditChainHead.findMany({
    orderBy: { scope: 'asc' },
  });
  const eventScopes = await prisma.systemAuditEvent.groupBy({ by: ['scope'] });
  if (
    eventScopes.some(({ scope }) => !heads.some((head) => head.scope === scope))
  ) {
    throw new RestoredDatabaseVerificationError(
      'RESTORE_SYSTEM_AUDIT_HEAD_MISSING',
    );
  }
  let totalEvents = 0;
  for (const head of heads) {
    let expectedSequence = 1;
    let previousHash = GENESIS_PREVIOUS_HASH;
    for (;;) {
      const events = await prisma.systemAuditEvent.findMany({
        where: { scope: head.scope, sequence: { gte: expectedSequence } },
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
        take: AUDIT_BATCH_SIZE,
      });
      if (events.length === 0) break;
      for (const event of events) {
        if (
          event.sequence !== expectedSequence ||
          event.previousHash !== previousHash ||
          event.primaryEntityKind !== 'runner_release'
        ) {
          throw new RestoredDatabaseVerificationError(
            'RESTORE_SYSTEM_AUDIT_LINK_INVALID',
          );
        }
        const computed = createRunnerReleaseSystemAuditHash({
          scope: event.scope,
          sequence: event.sequence,
          eventType: event.eventType,
          actorUserId: event.actorUserId,
          releaseId: event.primaryEntityId,
          occurredAt: event.occurredAt,
          sourceId: event.sourceId,
          payload: event.payload,
          previousHash: event.previousHash,
        });
        if (
          computed.payloadDigest !== event.payloadDigest ||
          computed.eventHash !== event.eventHash
        ) {
          throw new RestoredDatabaseVerificationError(
            'RESTORE_SYSTEM_AUDIT_HASH_INVALID',
          );
        }
        previousHash = event.eventHash;
        expectedSequence += 1;
        totalEvents += 1;
      }
      if (events.length < AUDIT_BATCH_SIZE) break;
    }
    if (
      head.lastSequence !== expectedSequence - 1 ||
      head.lastEventHash !== previousHash
    ) {
      throw new RestoredDatabaseVerificationError(
        'RESTORE_SYSTEM_AUDIT_HEAD_MISMATCH',
      );
    }
    if (head.scope !== RUNNER_RELEASE_SYSTEM_AUDIT_SCOPE) {
      throw new RestoredDatabaseVerificationError(
        'RESTORE_SYSTEM_AUDIT_SCOPE_UNSUPPORTED',
      );
    }
  }
  return { chains: heads.length, events: totalEvents };
}

export async function verifyRestoredDatabase(
  prisma: PrismaClient,
  options: RestoredDatabaseVerificationOptions = {},
): Promise<RestoredDatabaseVerificationResult> {
  const migrationRows = await prisma.$queryRaw<
    Array<{ completed: bigint; incomplete: bigint }>
  >`SELECT
      count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS completed,
      count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS incomplete
    FROM "_prisma_migrations"`;
  const migrationState = migrationRows[0];
  if (migrationState === undefined || migrationState.incomplete !== 0n) {
    throw new RestoredDatabaseVerificationError(
      'RESTORE_MIGRATION_STATE_INVALID',
    );
  }

  const workspaceAudit = await verifyWorkspaceAuditChains(prisma);
  const systemAudit = await verifySystemAuditChains(prisma);
  const now = new Date();
  const [
    expiredActiveWorkflowRuns,
    pendingNotificationOutboxMessages,
    runnerDevices,
    runnerReleases,
    runnerRollouts,
  ] = await Promise.all([
    prisma.workflowRun.count({
      where: {
        status: {
          in: [
            'CLAIMED',
            'RUNNING',
            'WAITING_FOR_APPROVAL',
            'WAITING_FOR_REPAIR',
          ],
        },
        leaseExpiresAt: { lte: now },
      },
    }),
    prisma.notificationOutboxMessage.count({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
    }),
    prisma.runnerDevice.count(),
    prisma.runnerRelease.count(),
    prisma.runnerReleaseRollout.count(),
  ]);
  if (
    options.requireRecoveredRuns === true &&
    expiredActiveWorkflowRuns !== 0
  ) {
    throw new RestoredDatabaseVerificationError(
      'RESTORE_EXPIRED_ACTIVE_RUNS_REMAIN',
    );
  }
  return {
    valid: true,
    completedMigrationCount: Number(migrationState.completed),
    workspaceAuditChains: workspaceAudit.chains,
    workspaceAuditEvents: workspaceAudit.events,
    systemAuditChains: systemAudit.chains,
    systemAuditEvents: systemAudit.events,
    expiredActiveWorkflowRuns,
    pendingNotificationOutboxMessages,
    runnerDevices,
    runnerReleases,
    runnerRollouts,
  };
}
