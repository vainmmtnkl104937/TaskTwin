import {
  AUDIT_PAYLOAD_SCHEMAS,
  parseAuditPayload,
} from '@tasktwin/audit-trail';
import type { AuditEventRecord } from '@tasktwin/database';

import {
  AuditEventDetailResponseSchema,
  AuditEventListResponseSchema,
  AuditVerifyResponseSchema,
  RunEvidenceResponseSchema,
  type AuditEventListResponse,
  type AuditEventDetailResponse,
  type AuditVerifyResponse,
  type RunEvidenceResponse,
} from './audit-trail.contracts.js';

const SAFE_RUN_EVENT_TYPES = new Set([
  'workflow_run.created',
  'workflow_run.claimed',
  'workflow_run.started',
  'workflow_run.waiting_for_approval',
  'workflow_run.waiting_for_repair',
  'workflow_run.cancel_requested',
  'workflow_run.succeeded',
  'workflow_run.failed',
  'workflow_run.cancelled',
  'workflow_run.timed_out',
  'workflow_run.interrupted',
  'execution.attempt_started',
  'execution.attempt_terminal',
  'execution.verification_completed',
  'execution.output_produced',
]);

function safePayload(eventType: string, payload: unknown): unknown {
  return parseAuditPayload(
    eventType as keyof typeof AUDIT_PAYLOAD_SCHEMAS,
    payload,
  );
}

function listEventDto(record: AuditEventRecord) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    sequence: record.sequence,
    eventType: record.eventType,
    actor: record.actor,
    primaryEntity: record.primaryEntity,
    relatedEntities: record.relatedEntities,
    occurredAt: record.occurredAt,
    sourceId: record.sourceId,
    ...(record.correlationId === undefined
      ? {}
      : { correlationId: record.correlationId }),
    payload: safePayload(record.eventType, record.payload),
  };
}

function detailEventDto(record: AuditEventRecord) {
  return {
    ...listEventDto(record),
    payloadDigest: record.payloadDigest,
    previousHash: record.previousHash,
    eventHash: record.eventHash,
    createdAt: record.createdAt,
  };
}

export function encodeCursor(sequence: number, id: string): string {
  return Buffer.from(`${sequence}:${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { sequence: number; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^(\d+):([0-9a-f-]{36})$/i.exec(decoded);
  if (match === null) {
    throw new Error('AUDIT_INVALID_CURSOR');
  }
  return { sequence: Number(match[1]), id: match[2] ?? '' };
}

export function listEventsResponse(input: {
  workspaceId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  events: AuditEventRecord[];
  nextCursorSequence: number | null;
  nextCursorId: string | null;
}): AuditEventListResponse {
  const canVerify = input.role === 'OWNER' || input.role === 'ADMIN';
  const nextCursor =
    input.nextCursorSequence === null || input.nextCursorId === null
      ? null
      : {
          sequence: input.nextCursorSequence,
          id: input.nextCursorId,
          encoded: encodeCursor(input.nextCursorSequence, input.nextCursorId),
        };
  return AuditEventListResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    access: { role: input.role, canVerify },
    events: input.events.map(listEventDto),
    nextCursor,
  });
}

export function detailEventResponse(input: {
  event: AuditEventRecord;
}): AuditEventDetailResponse {
  return AuditEventDetailResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: input.event.workspaceId,
    event: detailEventDto(input.event),
  });
}

export function runEvidenceResponse(input: {
  workspaceId: string;
  workflowRunId: string;
  events: AuditEventRecord[];
}): RunEvidenceResponse {
  const safe = input.events.filter((event) =>
    SAFE_RUN_EVENT_TYPES.has(event.eventType),
  );
  return RunEvidenceResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    workflowRunId: input.workflowRunId,
    events: safe.map((event) => ({
      id: event.id,
      sequence: event.sequence,
      eventType: event.eventType,
      actor: event.actor,
      primaryEntity: event.primaryEntity,
      occurredAt: event.occurredAt,
      payload: safePayload(event.eventType, event.payload),
    })),
  });
}

export function verifyResponse(input: {
  workspaceId: string;
  result: {
    valid: boolean;
    checkedCount: number;
    firstSequence: number | null;
    lastSequence: number | null;
    computedHeadHash: string;
    failureCode?:
      | 'SEQUENCE_GAP'
      | 'PREVIOUS_HASH_MISMATCH'
      | 'PAYLOAD_DIGEST_MISMATCH'
      | 'EVENT_HASH_MISMATCH'
      | 'HEAD_HASH_MISMATCH';
    failureSequence?: number;
  };
}): AuditVerifyResponse {
  const status: 'ok' | 'tampered' | 'sequence_gap' = input.result.valid
    ? 'ok'
    : input.result.failureCode === 'SEQUENCE_GAP'
      ? 'sequence_gap'
      : 'tampered';
  const response = {
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    status,
    checkedCount: input.result.checkedCount,
    firstSequence: input.result.firstSequence,
    lastSequence: input.result.lastSequence,
    headHash: input.result.computedHeadHash,
    ...(input.result.failureCode !== undefined &&
    input.result.failureSequence !== undefined
      ? {
          firstFailure: {
            sequence: input.result.failureSequence,
            kind: input.result.failureCode,
          },
        }
      : {}),
  };
  return AuditVerifyResponseSchema.parse(response);
}

export const SAFE_RUN_EVENT_TYPE_LIST = [...SAFE_RUN_EVENT_TYPES];