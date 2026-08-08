import { createHash } from 'node:crypto';

import {
  LocalSecretInventorySyncRequestSchema,
  createLocalSecretInventoryDigest,
  type LocalSecretInventorySyncRequest,
  type LocalSecretStoreStatus,
} from '@tasktwin/local-secret-store';

import { appendAuditEventTransactional } from '../audit-trail/audit-appender.repository.js';
import { WorkspaceAuditTrailRepository } from '../audit-trail/audit-trail.repository.js';
import { Prisma, RunnerSecretStoreStatus, type PrismaClient } from '../generated/prisma/client.js';
import { RunnerSecretInventoryRepositoryError } from './runner-secret-inventory-errors.js';
import type { RunnerSecretInventoryRecord, RunnerSecretInventorySyncResult } from './runner-secret-inventory-records.js';

const digestProvider = {
  sha256Hex: (input: string) => createHash('sha256').update(input, 'utf8').digest('hex'),
};

const STATUS_TO_DB: Record<LocalSecretStoreStatus, RunnerSecretStoreStatus> = {
  ready: RunnerSecretStoreStatus.READY,
  locked: RunnerSecretStoreStatus.LOCKED,
  unavailable: RunnerSecretStoreStatus.UNAVAILABLE,
  corrupted: RunnerSecretStoreStatus.CORRUPTED,
};

const STATUS_FROM_DB: Record<RunnerSecretStoreStatus, LocalSecretStoreStatus> = {
  READY: 'ready', LOCKED: 'locked', UNAVAILABLE: 'unavailable', CORRUPTED: 'corrupted',
};

export class RunnerSecretInventoryRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditTrail = new WorkspaceAuditTrailRepository(prisma),
  ) {}

  async synchronize(input: {
    runnerDeviceId: string;
    workspaceId: string;
    request: LocalSecretInventorySyncRequest;
  }): Promise<RunnerSecretInventorySyncResult> {
    const request = LocalSecretInventorySyncRequestSchema.safeParse(input.request);
    if (!request.success) throw new RunnerSecretInventoryRepositoryError('INVENTORY_INVALID');
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "runner_devices"
        WHERE "id" = ${input.runnerDeviceId}::uuid
          AND "workspace_id" = ${input.workspaceId}::uuid
          AND "revoked_at" IS NULL
        FOR UPDATE
      `;
      if (locked.length === 0) throw new RunnerSecretInventoryRepositoryError('RUNNER_UNAVAILABLE');
      const existing = await transaction.runnerSecretInventory.findUnique({
        where: { runnerDeviceId: input.runnerDeviceId }, include: { entries: true },
      });
      const databaseNow = (await transaction.$queryRaw<Array<{ now: Date }>>`
        SELECT clock_timestamp() AS "now"
      `)[0]?.now;
      if (databaseNow === undefined) throw new RunnerSecretInventoryRepositoryError('INVENTORY_INVALID');

      if (request.data.storeStatus !== 'ready') {
        if (existing === null) throw new RunnerSecretInventoryRepositoryError('INVENTORY_NOT_INITIALIZED');
        const updated = await transaction.runnerSecretInventory.update({
          where: { runnerDeviceId: input.runnerDeviceId },
          data: { storeStatus: STATUS_TO_DB[request.data.storeStatus], lastSynchronizedAt: databaseNow },
          include: { entries: true },
        });
        return { inventory: toRecord(updated), idempotent: true };
      }

      const calculated = createLocalSecretInventoryDigest(digestProvider, {
        vaultId: request.data.vaultId,
        workspaceId: input.workspaceId,
        runnerDeviceId: input.runnerDeviceId,
        vaultRevision: request.data.vaultRevision,
        entries: request.data.entries,
      });
      if (calculated !== request.data.inventoryDigest) throw new RunnerSecretInventoryRepositoryError('INVENTORY_INVALID');
      if (existing !== null && existing.vaultId !== request.data.vaultId) {
        throw new RunnerSecretInventoryRepositoryError('VAULT_IDENTITY_CONFLICT');
      }
      if (existing !== null && request.data.vaultRevision < existing.vaultRevision) {
        throw new RunnerSecretInventoryRepositoryError('INVENTORY_ROLLBACK_DETECTED');
      }
      if (existing !== null && request.data.vaultRevision === existing.vaultRevision &&
        request.data.inventoryDigest !== existing.inventoryDigest) {
        throw new RunnerSecretInventoryRepositoryError('INVENTORY_REVISION_CONFLICT');
      }
      const idempotent = existing !== null && request.data.vaultRevision === existing.vaultRevision;
      const previousRevision = existing?.vaultRevision ?? 0;
      const row = existing === null
        ? await transaction.runnerSecretInventory.create({
            data: { runnerDeviceId: input.runnerDeviceId, workspaceId: input.workspaceId,
              vaultId: request.data.vaultId, vaultRevision: request.data.vaultRevision,
              storeStatus: RunnerSecretStoreStatus.READY,
              inventoryDigest: request.data.inventoryDigest, lastSynchronizedAt: databaseNow,
              entries: { create: request.data.entries.map((entry) => ({ alias: entry.alias,
                secretVersionId: entry.secretVersionId })) } }, include: { entries: true },
          })
        : idempotent
          ? await transaction.runnerSecretInventory.update({
              where: { runnerDeviceId: input.runnerDeviceId },
              data: { storeStatus: RunnerSecretStoreStatus.READY, lastSynchronizedAt: databaseNow },
              include: { entries: true },
            })
          : await updateInventory(transaction, input.runnerDeviceId, request.data, databaseNow);

      if (!idempotent) {
        await appendAuditEventTransactional(transaction, this.auditTrail, {
          workspaceId: input.workspaceId,
          eventType: 'runner.secret_inventory.updated',
          actor: { type: 'runner', runnerDeviceId: input.runnerDeviceId },
          primaryEntity: { kind: 'runner_device', id: input.runnerDeviceId },
          occurredAt: databaseNow,
          sourceId: `runner-secret-inventory:${input.runnerDeviceId}:${request.data.vaultRevision}`,
          payload: { runnerDeviceId: input.runnerDeviceId, previousRevision,
            newRevision: request.data.vaultRevision,
            configuredSecretCount: request.data.entries.length,
            inventoryDigest: request.data.inventoryDigest },
        });
      }
      return { inventory: toRecord(row), idempotent };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getForRunner(runnerDeviceId: string): Promise<RunnerSecretInventoryRecord | null> {
    const row = await this.prisma.runnerSecretInventory.findUnique({
      where: { runnerDeviceId }, include: { entries: true },
    });
    return row === null ? null : toRecord(row);
  }
}

async function updateInventory(
  transaction: Prisma.TransactionClient,
  runnerDeviceId: string,
  request: Extract<LocalSecretInventorySyncRequest, { storeStatus: 'ready' }>,
  databaseNow: Date,
) {
  await transaction.runnerSecretInventoryEntry.deleteMany({ where: { runnerDeviceId } });
  return transaction.runnerSecretInventory.update({
    where: { runnerDeviceId },
    data: { vaultRevision: request.vaultRevision, storeStatus: RunnerSecretStoreStatus.READY,
      inventoryDigest: request.inventoryDigest, lastSynchronizedAt: databaseNow,
      entries: { create: request.entries.map((entry) => ({ alias: entry.alias,
        secretVersionId: entry.secretVersionId })) } }, include: { entries: true },
  });
}

function toRecord(row: {
  runnerDeviceId: string; workspaceId: string; vaultId: string; vaultRevision: number;
  storeStatus: RunnerSecretStoreStatus; inventoryDigest: string; lastSynchronizedAt: Date;
  entries: Array<{ alias: string; secretVersionId: string }>;
}): RunnerSecretInventoryRecord {
  return { runnerDeviceId: row.runnerDeviceId, workspaceId: row.workspaceId,
    vaultId: row.vaultId, vaultRevision: row.vaultRevision,
    storeStatus: STATUS_FROM_DB[row.storeStatus], inventoryDigest: row.inventoryDigest,
    lastSynchronizedAt: row.lastSynchronizedAt,
    entries: row.entries.map((entry) => ({ alias: entry.alias, secretVersionId: entry.secretVersionId }))
      .sort((left, right) => left.alias.localeCompare(right.alias)) };
}
