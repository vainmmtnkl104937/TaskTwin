import { createHash } from 'node:crypto';

import { randomUUID } from 'node:crypto';

import {
  appendAuditEvent,
  type AuditAppenderDriver,
  type AuditChainHead,
  type AuditHasher,
  type PendingAuditEvent,
  type StoredAuditEvent,
} from '@tasktwin/audit-trail';

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { WorkspaceAuditTrailRepository } from './audit-trail.repository.js';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const auditHasher: AuditHasher = { sha256Hex };

function actorIdOf(actor: PendingAuditEvent['actor']): string {
  if (actor.type === 'user') return actor.userId;
  if (actor.type === 'runner') return actor.runnerDeviceId;
  return 'system';
}

function actorReasonOf(
  actor: PendingAuditEvent['actor'],
): string | null {
  if (actor.type === 'system') return actor.reason;
  return null;
}

export class PrismaAuditAppenderDriver implements AuditAppenderDriver {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
    private readonly trail: WorkspaceAuditTrailRepository,
  ) {}

  async lockChainHead(workspaceId: string): Promise<AuditChainHead> {
    const tx = this.prisma as Prisma.TransactionClient;
    const head = await this.trail.ensureChainHead(workspaceId, tx);
    return {
      workspaceId: head.workspaceId,
      lastSequence: head.lastSequence,
      lastEventHash: head.lastEventHash,
    };
  }

  async findEventBySourceId(
    workspaceId: string,
    sourceId: string,
  ): Promise<StoredAuditEvent | null> {
    const tx = this.prisma as Prisma.TransactionClient;
    return this.trail.findEventBySourceId(workspaceId, sourceId, tx);
  }

  async insertEvent(event: PendingAuditEvent): Promise<StoredAuditEvent> {
    const tx = this.prisma as Prisma.TransactionClient;
    const created = await tx.workspaceAuditEvent.create({
      data: {
        id: randomUUID(),
        workspaceId: event.workspaceId,
        sequence: event.sequence,
        schemaVersion: event.schemaVersion,
        eventType: event.eventType,
        actorType: event.actor.type,
        actorId: actorIdOf(event.actor),
        actorReason: actorReasonOf(event.actor),
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
      },
    });
    const head = await this.trail.getChainHead(event.workspaceId);
    await this.trail.updateChainHead(tx, {
      workspaceId: head.workspaceId,
      lastSequence: event.sequence,
      lastEventHash: event.eventHash,
      lastEventType: event.eventType,
      lastEventAt: created.occurredAt,
      updatedAt: head.updatedAt,
    });
    return {
      id: created.id,
      schemaVersion: 1,
      workspaceId: created.workspaceId,
      sequence: created.sequence,
      eventType: created.eventType as PendingAuditEvent['eventType'],
      actor: event.actor,
      primaryEntity: event.primaryEntity,
      relatedEntities: event.relatedEntities,
      occurredAt: created.occurredAt.toISOString(),
      sourceId: created.sourceId,
      ...(created.correlationId === null
        ? {}
        : { correlationId: created.correlationId }),
      payload: created.payload,
      payloadDigest: created.payloadDigest,
      previousHash: created.previousHash,
      eventHash: created.eventHash,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async updateChainHead(head: AuditChainHead): Promise<void> {
    const tx = this.prisma as Prisma.TransactionClient;
    const current = await this.trail.getChainHead(head.workspaceId);
    await this.trail.updateChainHead(tx, {
      workspaceId: head.workspaceId,
      lastSequence: head.lastSequence,
      lastEventHash: head.lastEventHash,
      lastEventType: current.lastEventType,
      lastEventAt: current.lastEventAt,
      updatedAt: current.updatedAt,
    });
  }
}

export const auditHasherForTrail: AuditHasher = auditHasher;

export async function appendAuditEventTransactional(
  prisma: PrismaClient | Prisma.TransactionClient,
  trail: WorkspaceAuditTrailRepository,
  input: unknown,
): Promise<{ event: StoredAuditEvent; idempotent: boolean }> {
  const driver = new PrismaAuditAppenderDriver(prisma, trail);
  return appendAuditEvent(driver, auditHasher, input);
}

export interface CreateAuditAppenderDriverOptions {
  client: PrismaClient | Prisma.TransactionClient;
  hasher?: AuditHasher;
  trail?: WorkspaceAuditTrailRepository;
}

export function createAuditAppenderDriver(
  options: CreateAuditAppenderDriverOptions,
): { driver: PrismaAuditAppenderDriver; hasher: AuditHasher } {
  const hasher = options.hasher ?? auditHasherForTrail;
  const trail = options.trail ?? new WorkspaceAuditTrailRepository(options.client);
  return {
    driver: new PrismaAuditAppenderDriver(options.client, trail),
    hasher,
  };
}
