import { z } from 'zod';

import {
  AUDIT_EVENT_TYPES,
  AuditActorSchema,
  AuditEntityKindSchema,
  AuditEntityRefSchema,
  AuditEventTypeSchema,
  AUDIT_PAYLOAD_SCHEMAS,
} from '@tasktwin/audit-trail';

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });

const ForbiddenKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Forbidden payload key shape.');

export const FORBIDDEN_AUDIT_PAYLOAD_KEYS = [
  'value',
  'text',
  'input',
  'secret',
  'token',
  'password',
  'ciphertext',
  'wrappedKey',
  'iv',
  'aad',
  'locator',
  'selector',
  'url',
  'href',
  'query',
  'fragment',
  'dom',
  'html',
  'screenshot',
  'stackTrace',
  'expectedValue',
  'observedValue',
  'expected',
  'observed',
  'rawError',
  'stack',
  'email',
  'userAgent',
  'ip',
  'username',
  'hostname',
  'outputLength',
  'outputHash',
] as const satisfies readonly string[];

const ForbiddenKeyUnion = z.enum(
  FORBIDDEN_AUDIT_PAYLOAD_KEYS as unknown as readonly [string, ...string[]],
);

export const AuditPayloadEnvelopeSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (
        FORBIDDEN_AUDIT_PAYLOAD_KEYS.includes(
          key as (typeof FORBIDDEN_AUDIT_PAYLOAD_KEYS)[number],
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Payload key '${key}' is forbidden in audit responses.`,
        });
      }
    }
  });

const TypedPayloadEnvelopeSchema = z.union(
  AUDIT_EVENT_TYPES.map((eventType) =>
    AUDIT_PAYLOAD_SCHEMAS[eventType].extend({}),
  ) as unknown as readonly [z.ZodType, ...z.ZodType[]],
);

export const AuditActorDtoSchema = AuditActorSchema;

export const AuditEntityRefDtoSchema = AuditEntityRefSchema;

export const AuditEventListQuerySchema = z
  .strictObject({
    eventTypes: z
      .array(AuditEventTypeSchema)
      .max(20, 'At most 20 eventTypes are allowed per query.')
      .optional(),
    actorKinds: z
      .array(z.enum(['user', 'runner', 'system']))
      .max(3)
      .optional(),
    primaryEntityKind: AuditEntityKindSchema.optional(),
    primaryEntityId: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
      .optional(),
    correlationId: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
      .optional(),
    fromOccurredAt: IsoDateSchema.optional(),
    toOccurredAt: IsoDateSchema.optional(),
    fromSequence: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    toSequence: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.fromSequence !== undefined &&
      value.toSequence !== undefined &&
      value.toSequence < value.fromSequence
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['toSequence'],
        message: 'toSequence must be greater than or equal to fromSequence.',
      });
    }
    if (
      value.fromOccurredAt !== undefined &&
      value.toOccurredAt !== undefined &&
      value.toOccurredAt < value.fromOccurredAt
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['toOccurredAt'],
        message: 'toOccurredAt must be greater than or equal to fromOccurredAt.',
      });
    }
  });

export const AuditEventListResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  access: z.strictObject({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
    canVerify: z.boolean(),
  }),
  events: z
    .array(
      z.strictObject({
        id: UuidSchema,
        workspaceId: UuidSchema,
        sequence: z.number().int().positive(),
        eventType: AuditEventTypeSchema,
        actor: AuditActorDtoSchema,
        primaryEntity: AuditEntityRefDtoSchema,
        relatedEntities: z.array(AuditEntityRefDtoSchema).max(8),
        occurredAt: IsoDateSchema,
        sourceId: z.string().min(1).max(160),
        correlationId: z.string().min(1).max(80).optional(),
        payload: TypedPayloadEnvelopeSchema,
      }),
    )
    .max(100),
  nextCursor: z
    .strictObject({
      sequence: z.number().int().positive(),
      id: UuidSchema,
      encoded: z.string().min(1).max(200),
    })
    .nullable(),
});

export const AuditEventDetailResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  event: z.strictObject({
    id: UuidSchema,
    workspaceId: UuidSchema,
    sequence: z.number().int().positive(),
    eventType: AuditEventTypeSchema,
    actor: AuditActorDtoSchema,
    primaryEntity: AuditEntityRefDtoSchema,
    relatedEntities: z.array(AuditEntityRefDtoSchema).max(8),
    occurredAt: IsoDateSchema,
    sourceId: z.string().min(1).max(160),
    correlationId: z.string().min(1).max(80).optional(),
    payload: TypedPayloadEnvelopeSchema,
    payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
    previousHash: z.string().regex(/^[0-9a-f]{64}$/),
    eventHash: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: IsoDateSchema,
  }),
});

export const AuditVerifyRequestSchema = z.strictObject({
  fromSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  toSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  sampleLimit: z.number().int().min(1).max(200).default(100),
});

export const AuditVerifyResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  status: z.enum(['ok', 'tampered', 'sequence_gap']),
  checkedCount: z.number().int().min(0).max(100_000),
  firstSequence: z.number().int().positive().nullable(),
  lastSequence: z.number().int().positive().nullable(),
  headHash: z.string().regex(/^[0-9a-f]{64}$/),
  firstFailure: z
    .strictObject({
      sequence: z.number().int().positive(),
      kind: z.enum([
        'SEQUENCE_GAP',
        'PREVIOUS_HASH_MISMATCH',
        'PAYLOAD_DIGEST_MISMATCH',
        'EVENT_HASH_MISMATCH',
        'HEAD_HASH_MISMATCH',
      ]),
    })
    .optional(),
});

export const RunEvidenceResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workspaceId: UuidSchema,
  workflowRunId: UuidSchema,
  events: z
    .array(
      z.strictObject({
        id: UuidSchema,
        sequence: z.number().int().positive(),
        eventType: AuditEventTypeSchema,
        actor: AuditActorDtoSchema,
        primaryEntity: AuditEntityRefDtoSchema,
        occurredAt: IsoDateSchema,
        payload: TypedPayloadEnvelopeSchema,
      }),
    )
    .max(1000),
});

export const AuditErrorResponseSchema = z.strictObject({
  code: z.enum([
    'AUDIT_EVENT_INVALID',
    'AUDIT_HASH_INVALID',
    'AUDIT_PAYLOAD_TOO_LARGE',
    'AUDIT_SOURCE_CONFLICT',
    'AUDIT_STORAGE_FAILURE',
    'AUDIT_EVENT_NOT_FOUND',
    'AUDIT_INVALID_CURSOR',
    'AUDIT_ACCESS_FORBIDDEN',
  ]),
  message: z.string().min(1).max(240),
});

export type AuditEventListQuery = z.infer<typeof AuditEventListQuerySchema>;
export type AuditEventListResponse = z.infer<typeof AuditEventListResponseSchema>;
export type AuditEventDetailResponse = z.infer<typeof AuditEventDetailResponseSchema>;
export type AuditVerifyRequest = z.infer<typeof AuditVerifyRequestSchema>;
export type AuditVerifyResponse = z.infer<typeof AuditVerifyResponseSchema>;
export type RunEvidenceResponse = z.infer<typeof RunEvidenceResponseSchema>;
export type AuditErrorResponse = z.infer<typeof AuditErrorResponseSchema>;

export {
  ForbiddenKeySchema,
  ForbiddenKeyUnion,
};