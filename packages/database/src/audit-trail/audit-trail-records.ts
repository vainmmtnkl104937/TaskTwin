import type {
  StoredAuditEvent as AuditEvent,
} from '@tasktwin/audit-trail';

export interface WorkspaceAuditChainHeadRecord {
  workspaceId: string;
  lastSequence: number;
  lastEventHash: string;
  lastEventType: string | null;
  lastEventAt: Date | null;
  updatedAt: Date;
}

export type AuditEventRecord = AuditEvent;

export interface ListAuditEventsFilters {
  workspaceId: string;
  eventTypes?: readonly string[];
  primaryEntityKind?: string;
  primaryEntityId?: string;
  correlationId?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
  cursor?: { sequence: number; id: string };
  limit: number;
}

export interface ListAuditEventsResult {
  events: AuditEventRecord[];
  nextCursor: { sequence: number; id: string } | null;
}

export type AuditChainHeadSnapshot = {
  workspaceId: string;
  lastSequence: number;
  lastEventHash: string;
};

export type VerifyAuditTrailRange = {
  workspaceId: string;
  fromSequence?: number;
  toSequence?: number;
  sampleLimit?: number;
};