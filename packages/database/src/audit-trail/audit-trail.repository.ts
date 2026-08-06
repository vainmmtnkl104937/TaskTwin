import {
  AUDIT_ENTITY_KINDS,
  type AuditEntityKind,
} from '@tasktwin/audit-trail';
import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AuditTrailRepositoryError } from './audit-trail-errors.js';
import {
  type AuditChainHeadSnapshot,
  type AuditEventRecord,
  type ListAuditEventsFilters,
  type ListAuditEventsResult,
  type VerifyAuditTrailRange,
  type WorkspaceAuditChainHeadRecord,
} from './audit-trail-records.js';

const ENTITY_KIND_SET: ReadonlySet<AuditEntityKind> = new Set(
  AUDIT_ENTITY_KINDS,
);

function isActorReason(value: string): value is 'run_cancelled' | 'lease_expired' | 'automatic_expiry' | 'completion_reconciliation' | 'policy_supersede' {
  return (
    value === 'run_cancelled' ||
    value === 'lease_expired' ||
    value === 'automatic_expiry' ||
    value === 'completion_reconciliation' ||
    value === 'policy_supersede'
  );
}

function isEntityKind(value: string): value is AuditEntityKind {
  return ENTITY_KIND_SET.has(value as AuditEntityKind);
}

function asString(value: string | null): string {
  return value ?? '';
}

function asEntityRef(value: { kind: string; id: string }): {
  kind: AuditEntityKind;
  id: string;
} {
  return {
    kind: isEntityKind(value.kind) ? value.kind : 'workflow',
    id: value.id,
  };
}

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function toAuditEventRecord(row: {
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
}): AuditEventRecord {
  const actor = (() => {
    const reason = asString(row.actorReason);
    if (row.actorType === 'user' && reason === '') {
      return { type: 'user', userId: row.actorId } as const;
    }
    if (row.actorType === 'runner' && reason === '') {
      return { type: 'runner', runnerDeviceId: row.actorId } as const;
    }
    return {
      type: 'system',
      reason: isActorReason(reason) ? reason : 'automatic_expiry',
    } as const;
  })();
  const relatedEntities = Array.isArray(row.relatedEntities)
    ? (row.relatedEntities as Array<{ kind: string; id: string }>).map(asEntityRef)
    : [];
  return {
    id: row.id,
    schemaVersion: row.schemaVersion as 1,
    workspaceId: row.workspaceId,
    sequence: row.sequence,
    eventType: row.eventType as AuditEventRecord['eventType'],
    actor,
    primaryEntity: {
      kind: isEntityKind(row.primaryEntityKind)
        ? row.primaryEntityKind
        : 'workflow',
      id: row.primaryEntityId,
    },
    relatedEntities,
    occurredAt: row.occurredAt.toISOString(),
    sourceId: row.sourceId,
    ...(row.correlationId === null
      ? {}
      : { correlationId: row.correlationId }),
    payload: row.payload,
    payloadDigest: row.payloadDigest,
    previousHash: row.previousHash,
    eventHash: row.eventHash,
    createdAt: row.createdAt.toISOString(),
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < MIN_LIMIT) return MIN_LIMIT;
  if (limit > MAX_LIMIT) return MAX_LIMIT;
  return limit;
}

export class WorkspaceAuditTrailRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async getChainHead(
    workspaceId: string,
  ): Promise<WorkspaceAuditChainHeadRecord> {
    const row = await this.prisma.workspaceAuditChainHead.findUnique({
      where: { workspaceId },
    });
    if (row === null) {
      throw new AuditTrailRepositoryError('AUDIT_CHAIN_HEAD_MISSING');
    }
    return {
      workspaceId: row.workspaceId,
      lastSequence: row.lastSequence,
      lastEventHash: row.lastEventHash,
      lastEventType: row.lastEventType,
      lastEventAt: row.lastEventAt,
      updatedAt: row.updatedAt,
    };
  }

  async ensureChainHead(
    workspaceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceAuditChainHeadRecord> {
    await tx.$queryRaw`SELECT "workspace_id" FROM "workspace_audit_chain_heads" WHERE "workspace_id" = ${workspaceId}::uuid FOR UPDATE`;
    const row = await tx.workspaceAuditChainHead.findUnique({
      where: { workspaceId },
    });
    if (row === null) {
      throw new AuditTrailRepositoryError('AUDIT_CHAIN_HEAD_MISSING');
    }
    return {
      workspaceId: row.workspaceId,
      lastSequence: row.lastSequence,
      lastEventHash: row.lastEventHash,
      lastEventType: row.lastEventType,
      lastEventAt: row.lastEventAt,
      updatedAt: row.updatedAt,
    };
  }

  async updateChainHead(
    tx: Prisma.TransactionClient,
    head: WorkspaceAuditChainHeadRecord,
  ): Promise<void> {
    await tx.workspaceAuditChainHead.update({
      where: { workspaceId: head.workspaceId },
      data: {
        lastSequence: head.lastSequence,
        lastEventHash: head.lastEventHash,
        lastEventType: head.lastEventType,
        lastEventAt: head.lastEventAt,
        updatedAt: head.updatedAt,
      },
    });
  }

  async listAuditEvents(
    filters: ListAuditEventsFilters,
  ): Promise<ListAuditEventsResult> {
    const limit = clampLimit(filters.limit);
    const where: Prisma.WorkspaceAuditEventWhereInput = {
      workspaceId: filters.workspaceId,
    };
    if (filters.eventTypes && filters.eventTypes.length > 0) {
      where.eventType = { in: [...filters.eventTypes] };
    }
    if (filters.primaryEntityKind !== undefined) {
      where.primaryEntityKind = filters.primaryEntityKind;
    }
    if (filters.primaryEntityId !== undefined) {
      where.primaryEntityId = filters.primaryEntityId;
    }
    if (filters.correlationId !== undefined) {
      where.correlationId = filters.correlationId;
    }
    if (
      filters.occurredAfter !== undefined ||
      filters.occurredBefore !== undefined
    ) {
      where.occurredAt = {};
      if (filters.occurredAfter !== undefined) {
        where.occurredAt.gte = filters.occurredAfter;
      }
      if (filters.occurredBefore !== undefined) {
        where.occurredAt.lte = filters.occurredBefore;
      }
    }
    if (filters.cursor !== undefined) {
      where.OR = [
        { sequence: { gt: filters.cursor.sequence } },
        {
          sequence: filters.cursor.sequence,
          id: { gt: filters.cursor.id },
        },
      ];
    }
    const rows = await this.prisma.workspaceAuditEvent.findMany({
      where,
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const events = trimmed.map(toAuditEventRecord);
    const last = trimmed.at(-1);
    const nextCursor =
      hasMore && last !== undefined
        ? { sequence: last.sequence, id: last.id }
        : null;
    return { events, nextCursor };
  }

  async getAuditEvent(auditEventId: string): Promise<AuditEventRecord | null> {
    if (!isUuid(auditEventId)) return null;
    const row = await this.prisma.workspaceAuditEvent.findUnique({
      where: { id: auditEventId },
    });
    return row === null ? null : toAuditEventRecord(row);
  }

  async readRangeForVerification(
    range: VerifyAuditTrailRange,
    hasher: { sha256Hex: (value: string) => string },
  ): Promise<{
    chainHead: WorkspaceAuditChainHeadRecord;
    events: AuditEventRecord[];
  }> {
    const chainHead = await this.getChainHead(range.workspaceId);
    const sampleLimit = clampSampleLimit(range.sampleLimit);
    const fromSequence = range.fromSequence ?? 1;
    const where: Prisma.WorkspaceAuditEventWhereInput = {
      workspaceId: range.workspaceId,
      sequence: { gte: fromSequence },
    };
    if (range.toSequence !== undefined) {
      where.sequence = {
        gte: fromSequence,
        lte: range.toSequence,
      };
    }
    const rows = await this.prisma.workspaceAuditEvent.findMany({
      where,
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: sampleLimit,
    });
    if (rows.length === 0) {
      return { chainHead, events: [] };
    }
    void hasher;
    void createHash;
    return {
      chainHead,
      events: rows.map(toAuditEventRecord),
    };
  }

  async findEventBySourceId(
    workspaceId: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<AuditEventRecord | null> {
    const row = await tx.workspaceAuditEvent.findUnique({
      where: { workspaceId_sourceId: { workspaceId, sourceId } },
    });
    return row === null ? null : toAuditEventRecord(row);
  }

  async insertEvent(
    tx: Prisma.TransactionClient,
    event: AuditEventRecord,
  ): Promise<AuditEventRecord> {
    const created = await tx.workspaceAuditEvent.create({
      data: {
        id: event.id,
        workspaceId: event.workspaceId,
        sequence: event.sequence,
        schemaVersion: event.schemaVersion,
        eventType: event.eventType,
        actorType: event.actor.type,
        actorId: actorId(event.actor),
        actorReason: actorReason(event.actor),
        primaryEntityKind: event.primaryEntity.kind,
        primaryEntityId: event.primaryEntity.id,
        relatedEntities: event.relatedEntities as unknown as Prisma.InputJsonValue,
        occurredAt: new Date(event.occurredAt),
        sourceId: event.sourceId,
        correlationId: event.correlationId ?? null,
        payload: event.payload as unknown as Prisma.InputJsonValue,
        payloadDigest: event.payloadDigest,
        previousHash: event.previousHash,
        eventHash: event.eventHash,
        createdAt: new Date(event.createdAt),
      },
    });
    return toAuditEventRecord(created);
  }
}

function actorId(actor: AuditEventRecord['actor']): string {
  if (actor.type === 'user') return actor.userId;
  if (actor.type === 'runner') return actor.runnerDeviceId;
  return 'system';
}

function actorReason(actor: AuditEventRecord['actor']): string | null {
  if (actor.type === 'system') return actor.reason;
  return null;
}

function clampSampleLimit(value: number | undefined): number {
  if (value === undefined) return 100_000;
  if (!Number.isInteger(value) || value < 1) return 1;
  if (value > 100_000) return 100_000;
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function toChainHeadSnapshot(
  head: WorkspaceAuditChainHeadRecord,
): AuditChainHeadSnapshot {
  return {
    workspaceId: head.workspaceId,
    lastSequence: head.lastSequence,
    lastEventHash: head.lastEventHash,
  };
}