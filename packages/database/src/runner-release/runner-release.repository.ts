import { createHash, randomUUID } from 'node:crypto';

import { ReleaseManifestSchema } from '@tasktwin/runner-release';
import {
  assertReleaseStatusTransition,
  type RunnerReleaseCatalogStatus,
  type RunnerReleaseStatusReason,
} from '@tasktwin/runner-rollout';

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { createCanonicalJsonDigest } from '../recording/canonical-json.js';
import { appendAuditEventTransactional } from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import type { OperationalAlertTransactionAppender } from '../operational-alerts/operational-alert-port.js';
import { RunnerReleaseRepositoryError } from './runner-release-errors.js';
import type {
  RunnerReleaseRecord,
  TrustedRunnerReleaseImport,
} from './runner-release-records.js';

const SYSTEM_AUDIT_SCOPE = 'runner-release-catalog';

function toRecord(row: {
  id: string;
  product: string;
  version: string;
  manifestDigest: string;
  manifest: unknown;
  signingKeyId: string;
  sourceCommit: string;
  builtAt: Date;
  status: string;
  statusReasonCode: string | null;
  importedByUserId: string;
  statusChangedByUserId: string | null;
  statusChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RunnerReleaseRecord {
  return {
    ...row,
    manifest: ReleaseManifestSchema.parse(row.manifest),
    status: row.status as RunnerReleaseCatalogStatus,
    statusReasonCode: row.statusReasonCode as RunnerReleaseStatusReason | null,
  };
}

async function requireSystemAdministrator(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { isActive: true, isSystemAdministrator: true },
  });
  if (user?.isActive !== true || user.isSystemAdministrator !== true) {
    throw new RunnerReleaseRepositoryError('SYSTEM_ADMIN_REQUIRED');
  }
}

async function appendSystemAudit(input: {
  tx: Prisma.TransactionClient;
  eventType: 'runner.release.imported' | 'runner.release.status_changed';
  actorUserId: string;
  releaseId: string;
  occurredAt: Date;
  sourceId: string;
  payload: Record<string, string | number | null>;
}): Promise<boolean> {
  const existing = await input.tx.systemAuditEvent.findUnique({
    where: {
      scope_sourceId: { scope: SYSTEM_AUDIT_SCOPE, sourceId: input.sourceId },
    },
  });
  const payloadDigest = createCanonicalJsonDigest(input.payload);
  if (existing !== null) {
    if (existing.payloadDigest !== payloadDigest) {
      throw new RunnerReleaseRepositoryError('RELEASE_IMPORT_CONFLICT');
    }
    return true;
  }
  await input.tx.systemAuditChainHead.upsert({
    where: { scope: SYSTEM_AUDIT_SCOPE },
    create: { scope: SYSTEM_AUDIT_SCOPE },
    update: {},
  });
  const [head] = await input.tx.$queryRaw<
    Array<{ last_sequence: number; last_event_hash: string }>
  >`SELECT last_sequence, last_event_hash FROM system_audit_chain_heads WHERE scope = ${SYSTEM_AUDIT_SCOPE} FOR UPDATE`;
  if (head === undefined)
    throw new Error('System audit chain head unavailable.');
  const sequence = head.last_sequence + 1;
  const eventHash = createHash('sha256')
    .update(
      JSON.stringify({
        scope: SYSTEM_AUDIT_SCOPE,
        sequence,
        eventType: input.eventType,
        actorUserId: input.actorUserId,
        releaseId: input.releaseId,
        occurredAt: input.occurredAt.toISOString(),
        sourceId: input.sourceId,
        payloadDigest,
        previousHash: head.last_event_hash,
      }),
      'utf8',
    )
    .digest('hex');
  await input.tx.systemAuditEvent.create({
    data: {
      id: randomUUID(),
      scope: SYSTEM_AUDIT_SCOPE,
      sequence,
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      primaryEntityKind: 'runner_release',
      primaryEntityId: input.releaseId,
      occurredAt: input.occurredAt,
      sourceId: input.sourceId,
      payload: input.payload,
      payloadDigest,
      previousHash: head.last_event_hash,
      eventHash,
    },
  });
  await input.tx.systemAuditChainHead.update({
    where: { scope: SYSTEM_AUDIT_SCOPE },
    data: { lastSequence: sequence, lastEventHash: eventHash },
  });
  return false;
}

export class RunnerReleaseRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly operationalAlerts?: OperationalAlertTransactionAppender,
  ) {}

  async list(
    input: {
      limit: number;
      cursor?: { builtAt: Date; id: string };
    } = { limit: 50 },
  ): Promise<{
    releases: RunnerReleaseRecord[];
    nextCursor: { builtAt: Date; id: string } | null;
  }> {
    const releases = await this.prisma.runnerRelease.findMany({
      ...(input.cursor === undefined
        ? {}
        : {
            where: {
              OR: [
                { builtAt: { lt: input.cursor.builtAt } },
                { builtAt: input.cursor.builtAt, id: { gt: input.cursor.id } },
              ],
            },
          }),
      orderBy: [{ builtAt: 'desc' }, { id: 'asc' }],
      take: input.limit + 1,
    });
    const hasMore = releases.length > input.limit;
    const page = releases.slice(0, input.limit);
    const last = page.at(-1);
    return {
      releases: page.map(toRecord),
      nextCursor:
        hasMore && last !== undefined
          ? { builtAt: last.builtAt, id: last.id }
          : null,
    };
  }

  async get(id: string): Promise<RunnerReleaseRecord | null> {
    const release = await this.prisma.runnerRelease.findUnique({
      where: { id },
    });
    return release === null ? null : toRecord(release);
  }

  async importTrusted(
    actorUserId: string,
    input: TrustedRunnerReleaseImport,
  ): Promise<{ release: RunnerReleaseRecord; idempotent: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        await requireSystemAdministrator(tx, actorUserId);
        const byDigest = await tx.runnerRelease.findUnique({
          where: { manifestDigest: input.manifestDigest },
        });
        if (byDigest !== null) {
          return { release: toRecord(byDigest), idempotent: true };
        }
        const byVersion = await tx.runnerRelease.findUnique({
          where: {
            product_version: {
              product: input.manifest.product,
              version: input.manifest.version,
            },
          },
        });
        if (byVersion !== null) {
          throw new RunnerReleaseRepositoryError('RELEASE_VERSION_CONFLICT');
        }
        const now = new Date();
        const release = await tx.runnerRelease.create({
          data: {
            product: input.manifest.product,
            version: input.manifest.version,
            manifestDigest: input.manifestDigest,
            manifest: input.manifest as unknown as Prisma.InputJsonValue,
            signingKeyId: input.manifest.signingKeyId,
            sourceCommit: input.manifest.sourceCommit,
            builtAt: new Date(input.manifest.builtAt),
            importedByUserId: actorUserId,
          },
        });
        await appendSystemAudit({
          tx,
          eventType: 'runner.release.imported',
          actorUserId,
          releaseId: release.id,
          occurredAt: now,
          sourceId: `runner-release-imported:${input.manifestDigest}`,
          payload: {
            releaseId: release.id,
            product: release.product,
            version: release.version,
            manifestDigest: release.manifestDigest,
            signingKeyId: release.signingKeyId,
            artifactCount: input.manifest.artifacts.length,
          },
        });
        return { release: toRecord(release), idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async changeStatus(input: {
    actorUserId: string;
    releaseId: string;
    nextStatus: 'deprecated' | 'blocked';
    reason: RunnerReleaseStatusReason;
  }): Promise<{ release: RunnerReleaseRecord; idempotent: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        await requireSystemAdministrator(tx, input.actorUserId);
        const release = await tx.runnerRelease.findUnique({
          where: { id: input.releaseId },
        });
        if (release === null) {
          throw new RunnerReleaseRepositoryError('RELEASE_NOT_FOUND');
        }
        if (
          release.status === input.nextStatus &&
          release.statusReasonCode === input.reason
        ) {
          return { release: toRecord(release), idempotent: true };
        }
        try {
          assertReleaseStatusTransition({
            current: release.status,
            next: input.nextStatus,
            reason: input.reason,
          });
        } catch {
          throw new RunnerReleaseRepositoryError('RELEASE_STATUS_CONFLICT');
        }
        const now = new Date();
        const updated = await tx.runnerRelease.update({
          where: { id: release.id },
          data: {
            status: input.nextStatus,
            statusReasonCode: input.reason,
            statusChangedByUserId: input.actorUserId,
            statusChangedAt: now,
          },
        });
        await appendSystemAudit({
          tx,
          eventType: 'runner.release.status_changed',
          actorUserId: input.actorUserId,
          releaseId: release.id,
          occurredAt: now,
          sourceId: `runner-release-status:${release.id}:${input.nextStatus}`,
          payload: {
            releaseId: release.id,
            previousStatus: release.status,
            status: input.nextStatus,
            reason: input.reason,
          },
        });
        if (input.nextStatus === 'blocked') {
          const affected = await tx.runnerReleaseRollout.findMany({
            where: { targetReleaseId: release.id, status: 'active' },
            orderBy: [{ workspaceId: 'asc' }, { id: 'asc' }],
          });
          for (const rollout of affected) {
            await tx.runnerReleaseRollout.update({
              where: { id: rollout.id },
              data: {
                status: 'paused',
                reviewReason: 'target_release_blocked',
                pausedAt: now,
              },
            });
            await tx.runnerReleaseRolloutStage.updateMany({
              where: { rolloutId: rollout.id, status: 'active' },
              data: {
                status: 'failed_review',
                reviewReason: 'target_release_blocked',
                failedReviewAt: now,
              },
            });
            await appendAuditEventTransactional(
              tx,
              new WorkspaceAuditTrailRepository(tx),
              {
                workspaceId: rollout.workspaceId,
                eventType: 'runner.rollout.paused',
                actor: { type: 'system', reason: 'automatic' },
                primaryEntity: {
                  kind: 'runner_release_rollout',
                  id: rollout.id,
                },
                occurredAt: now,
                sourceId: `runner-rollout-blocked:${rollout.id}`,
                payload: {
                  rolloutId: rollout.id,
                  status: 'paused',
                  reason: 'target_release_blocked',
                  changedAt: now,
                },
              },
            );
            await this.operationalAlerts?.append(tx, {
              schemaVersion: 1,
              workspaceId: rollout.workspaceId,
              type: 'runner_rollout_requires_review',
              source: { type: 'runner_release_rollout', id: rollout.id },
              primaryEntity: {
                type: 'runner_release_rollout',
                id: rollout.id,
              },
              relatedEntities: [],
              template: {
                schemaVersion: 1,
                templateKey: 'runner_rollout_requires_review.v1',
                rolloutId: rollout.id,
                reason: 'target_release_blocked',
                observedAt: now.toISOString(),
              },
              actionTarget: {
                schemaVersion: 1,
                kind: 'runner_rollout',
                workspaceId: rollout.workspaceId,
                rolloutId: rollout.id,
              },
            });
          }
        }
        return { release: toRecord(updated), idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
