import type { AuditActor } from './actor.js';
import { normalizeAuditTimestamp, serializeCanonicalJson } from './canonical-json.js';
import type { AuditEntityRef } from './entity-ref.js';
import type { AuditEventType } from './event-type.js';
import { hashAuditContent, requireSha256Hex, type AuditHasher } from './hasher.js';

export const AUDIT_EVENT_SCHEMA_VERSION = 1 as const;
export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

export interface AuditHashContent {
  schemaVersion: 1;
  workspaceId: string;
  sequence: number;
  eventType: AuditEventType;
  actor: AuditActor;
  primaryEntity: AuditEntityRef;
  relatedEntities: AuditEntityRef[];
  occurredAt: string;
  sourceId: string;
  correlationId?: string;
  payloadDigest: string;
  previousHash: string;
}

export function createAuditPayloadDigest(
  hasher: AuditHasher,
  payload: unknown,
): string {
  return hashAuditContent(hasher, serializeCanonicalJson(payload));
}

export function serializeAuditHashContent(input: AuditHashContent): string {
  const occurredAt = normalizeAuditTimestamp(input.occurredAt);
  const payloadDigest = requireSha256Hex(input.payloadDigest);
  const previousHash = requireSha256Hex(input.previousHash);
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new TypeError('Audit sequence is invalid');
  }
  return serializeCanonicalJson({
    actor: input.actor,
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
    eventType: input.eventType,
    occurredAt,
    payloadDigest,
    previousHash,
    primaryEntity: input.primaryEntity,
    relatedEntities: input.relatedEntities,
    schemaVersion: input.schemaVersion,
    sequence: input.sequence,
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
  });
}

export function createAuditEventHash(
  hasher: AuditHasher,
  input: AuditHashContent,
): string {
  return hashAuditContent(hasher, serializeAuditHashContent(input));
}
