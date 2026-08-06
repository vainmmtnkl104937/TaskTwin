import { z } from 'zod';

import { AuditActorSchema, type AuditActor } from './actor.js';
import { normalizeAuditTimestamp } from './canonical-json.js';
import {
  AuditEntityRefSchema,
  RelatedAuditEntitiesSchema,
  type AuditEntityRef,
} from './entity-ref.js';
import {
  AuditEventTypeSchema,
  type AuditEventType,
} from './event-type.js';
import {
  AUDIT_PAYLOAD_SCHEMAS,
  parseAuditPayload,
} from './payload-schemas.js';

export type AuditPayloadByType = {
  [EventType in AuditEventType]: z.infer<
    (typeof AUDIT_PAYLOAD_SCHEMAS)[EventType]
  >;
};

export type AuditPayloadEnvelope = {
  [EventType in AuditEventType]: {
    eventType: EventType;
    payload: AuditPayloadByType[EventType];
  };
}[AuditEventType];

// The payload is typed as `unknown` here because the schema transforms/validates
// at parse time. Callers pass raw values (Date, etc.) and the result of
// `parseAuditEventInput` is the parsed/transformed payload.
export interface AuditEventInput<EventType extends AuditEventType = AuditEventType> {
  schemaVersion?: 1;
  workspaceId: string;
  eventType: EventType;
  actor: AuditActor;
  primaryEntity: AuditEntityRef;
  relatedEntities?: AuditEntityRef[];
  occurredAt: Date | string;
  sourceId: string;
  correlationId?: string;
  payload: unknown;
}

const AuditEventInputBoundarySchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    workspaceId: z.string().uuid(),
    eventType: AuditEventTypeSchema,
    actor: AuditActorSchema,
    primaryEntity: AuditEntityRefSchema,
    relatedEntities: RelatedAuditEntitiesSchema.optional(),
    occurredAt: z.union([z.date(), z.string().datetime({ offset: true })]),
    sourceId: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
    correlationId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
      .optional(),
    payload: z.unknown(),
  })
  .strict();

export interface ParsedAuditEventInput<
  EventType extends AuditEventType = AuditEventType,
> {
  schemaVersion: 1;
  workspaceId: string;
  eventType: EventType;
  actor: AuditActor;
  primaryEntity: AuditEntityRef;
  relatedEntities: AuditEntityRef[];
  occurredAt: string;
  sourceId: string;
  correlationId?: string;
  payload: AuditPayloadByType[EventType];
}

export function parseAuditEventInput(
  input: unknown,
): ParsedAuditEventInput {
  const boundary = AuditEventInputBoundarySchema.parse(input);
  const payload = parseAuditPayload(boundary.eventType, boundary.payload);
  return {
    schemaVersion: 1,
    workspaceId: boundary.workspaceId,
    eventType: boundary.eventType,
    actor: boundary.actor,
    primaryEntity: boundary.primaryEntity,
    relatedEntities: boundary.relatedEntities ?? [],
    occurredAt: normalizeAuditTimestamp(boundary.occurredAt),
    sourceId: boundary.sourceId,
    ...(boundary.correlationId === undefined
      ? {}
      : { correlationId: boundary.correlationId }),
    payload,
  } as ParsedAuditEventInput;
}
