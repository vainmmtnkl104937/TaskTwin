import { serializeCanonicalJson } from './canonical-json.js';
import { AuditTrailError } from './errors.js';
import {
  createAuditEventHash,
  createAuditPayloadDigest,
  GENESIS_PREVIOUS_HASH,
  type AuditHashContent,
} from './hash-chain.js';
import type { AuditHasher } from './hasher.js';
import {
  parseAuditEventInput,
  type ParsedAuditEventInput,
} from './payload-union.js';

export interface AuditChainHead {
  workspaceId: string;
  lastSequence: number;
  lastEventHash: string;
}

export interface StoredAuditEvent extends AuditHashContent {
  id: string;
  payload: unknown;
  eventHash: string;
  createdAt: string;
}

export type PendingAuditEvent = Omit<StoredAuditEvent, 'id' | 'createdAt'>;

export interface AuditAppenderDriver {
  lockChainHead(workspaceId: string): Promise<AuditChainHead>;
  findEventBySourceId(
    workspaceId: string,
    sourceId: string,
  ): Promise<StoredAuditEvent | null>;
  insertEvent(event: PendingAuditEvent): Promise<StoredAuditEvent>;
  updateChainHead(head: AuditChainHead): Promise<void>;
}

export interface AppendAuditEventResult {
  event: StoredAuditEvent;
  idempotent: boolean;
}

function sourceMatches(
  stored: StoredAuditEvent,
  parsed: ParsedAuditEventInput,
  payloadDigest: string,
): boolean {
  return (
    stored.eventType === parsed.eventType &&
    stored.primaryEntity.kind === parsed.primaryEntity.kind &&
    stored.primaryEntity.id === parsed.primaryEntity.id &&
    stored.payloadDigest === payloadDigest
  );
}

export async function appendAuditEvent(
  driver: AuditAppenderDriver,
  hasher: AuditHasher,
  input: unknown,
): Promise<AppendAuditEventResult> {
  let parsed: ParsedAuditEventInput;
  try {
    parsed = parseAuditEventInput(input);
  } catch (error: unknown) {
    throw new AuditTrailError('AUDIT_EVENT_INVALID', { cause: error });
  }

  const canonicalPayload = serializeCanonicalJson(parsed.payload);
  if (canonicalPayload.length > 4_096) {
    throw new AuditTrailError('AUDIT_PAYLOAD_TOO_LARGE');
  }
  const payloadDigest = createAuditPayloadDigest(hasher, parsed.payload);
  const head = await driver.lockChainHead(parsed.workspaceId);
  const existing = await driver.findEventBySourceId(
    parsed.workspaceId,
    parsed.sourceId,
  );
  if (existing !== null) {
    if (!sourceMatches(existing, parsed, payloadDigest)) {
      throw new AuditTrailError('AUDIT_SOURCE_CONFLICT');
    }
    return { event: existing, idempotent: true };
  }

  const sequence = head.lastSequence + 1;
  const previousHash =
    head.lastSequence === 0 ? GENESIS_PREVIOUS_HASH : head.lastEventHash;
  const hashContent: AuditHashContent = {
    schemaVersion: 1,
    workspaceId: parsed.workspaceId,
    sequence,
    eventType: parsed.eventType,
    actor: parsed.actor,
    primaryEntity: parsed.primaryEntity,
    relatedEntities: parsed.relatedEntities,
    occurredAt: parsed.occurredAt,
    sourceId: parsed.sourceId,
    ...(parsed.correlationId === undefined
      ? {}
      : { correlationId: parsed.correlationId }),
    payloadDigest,
    previousHash,
  };
  const eventHash = createAuditEventHash(hasher, hashContent);
  const event = await driver.insertEvent({
    ...hashContent,
    payload: parsed.payload,
    eventHash,
  });
  await driver.updateChainHead({
    workspaceId: parsed.workspaceId,
    lastSequence: sequence,
    lastEventHash: eventHash,
  });
  return { event, idempotent: false };
}
