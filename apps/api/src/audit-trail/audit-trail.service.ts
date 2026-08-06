import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RecordingRepository,
  WorkspaceAuditTrailRepository,
} from '@tasktwin/database';
import {
  AuditTrailError,
  verifyAuditEventChain,
  type AuditHasher,
} from '@tasktwin/audit-trail';
import { createHash } from 'node:crypto';

import {
  decodeCursor,
  detailEventResponse,
  listEventsResponse,
  runEvidenceResponse,
  verifyResponse,
} from './audit-trail-response.mapper.js';
import type {
  AuditEventDetailResponse,
  AuditEventListQuery,
  AuditEventListResponse,
  AuditVerifyRequest,
  AuditVerifyResponse,
  RunEvidenceResponse,
} from './audit-trail.contracts.js';

const READER_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'MEMBER',
  'VIEWER',
]);

const VERIFIER_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMIN']);

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const auditHasher: AuditHasher = { sha256Hex };

const WORKFLOW_RUN_ENTITY_KIND = 'workflow_run';
const WORKFLOW_RUN_STEP_ENTITY_KIND = 'workflow_run_step';

@Injectable()
export class AuditTrailService {
  constructor(
    private readonly repository: WorkspaceAuditTrailRepository,
    private readonly recordingRepository: RecordingRepository,
  ) {}

  async listEvents(input: {
    workspaceId: string;
    actorUserId: string;
    query: AuditEventListQuery;
  }): Promise<AuditEventListResponse> {
    const access = await this.recordingRepository.resolveWorkspaceAccess(
      input.actorUserId,
      input.workspaceId,
    );
    if (access === null) {
      throw new NotFoundException({
        code: 'AUDIT_EVENT_NOT_FOUND',
        message: 'Audit events are not available for this workspace.',
      });
    }
    if (!READER_ROLES.has(access.role)) {
      throw new ForbiddenException('AUDIT_ACCESS_FORBIDDEN');
    }
    let cursor: { sequence: number; id: string } | undefined;
    if (input.query.cursor !== undefined) {
      try {
        cursor = decodeCursor(input.query.cursor);
      } catch {
        throw new BadRequestException({
          code: 'AUDIT_INVALID_CURSOR',
          message: 'The provided audit cursor is malformed.',
        });
      }
    }
    const actorKinds = input.query.actorKinds ?? [];
    const filterActorKinds = new Set(actorKinds);
    const result = await this.repository.listAuditEvents({
      workspaceId: input.workspaceId,
      ...(input.query.eventTypes !== undefined
        ? { eventTypes: input.query.eventTypes }
        : {}),
      ...(input.query.primaryEntityKind !== undefined
        ? { primaryEntityKind: input.query.primaryEntityKind }
        : {}),
      ...(input.query.primaryEntityId !== undefined
        ? { primaryEntityId: input.query.primaryEntityId }
        : {}),
      ...(input.query.correlationId !== undefined
        ? { correlationId: input.query.correlationId }
        : {}),
      ...(input.query.fromOccurredAt !== undefined
        ? { occurredAfter: new Date(input.query.fromOccurredAt) }
        : {}),
      ...(input.query.toOccurredAt !== undefined
        ? { occurredBefore: new Date(input.query.toOccurredAt) }
        : {}),
      ...(input.query.fromSequence !== undefined
        ? { fromSequence: input.query.fromSequence }
        : {}),
      ...(input.query.toSequence !== undefined
        ? { toSequence: input.query.toSequence }
        : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      limit: input.query.limit ?? 50,
    });
    const filteredEvents = result.events.filter((event) => {
      if (filterActorKinds.size === 0) {
        return true;
      }
      return filterActorKinds.has(event.actor.type);
    });
    return listEventsResponse({
      workspaceId: input.workspaceId,
      role: access.role,
      events: filteredEvents,
      nextCursorSequence: result.nextCursor?.sequence ?? null,
      nextCursorId: result.nextCursor?.id ?? null,
    });
  }

  async getEvent(input: {
    actorUserId: string;
    auditEventId: string;
  }): Promise<AuditEventDetailResponse> {
    const event = await this.repository.getAuditEvent(input.auditEventId);
    if (event === null) {
      throw new NotFoundException({
        code: 'AUDIT_EVENT_NOT_FOUND',
        message: 'The requested audit event does not exist.',
      });
    }
    const access = await this.recordingRepository.resolveWorkspaceAccess(
      input.actorUserId,
      event.workspaceId,
    );
    if (access === null) {
      throw new NotFoundException({
        code: 'AUDIT_EVENT_NOT_FOUND',
        message: 'The requested audit event does not exist.',
      });
    }
    if (!READER_ROLES.has(access.role)) {
      throw new NotFoundException({
        code: 'AUDIT_EVENT_NOT_FOUND',
        message: 'The requested audit event does not exist.',
      });
    }
    return detailEventResponse({ event });
  }

  async verifyChain(input: {
    workspaceId: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    request: AuditVerifyRequest;
  }): Promise<AuditVerifyResponse> {
    if (!VERIFIER_ROLES.has(input.role)) {
      throw new ForbiddenException('AUDIT_ACCESS_FORBIDDEN');
    }
    const head = await this.repository.getChainHead(input.workspaceId);
    const { events } = await this.repository.readRangeForVerification(
      {
        workspaceId: input.workspaceId,
        ...(input.request.fromSequence !== undefined
          ? { fromSequence: input.request.fromSequence }
          : {}),
        ...(input.request.toSequence !== undefined
          ? { toSequence: input.request.toSequence }
          : {}),
        sampleLimit: input.request.sampleLimit ?? 100,
      },
      auditHasher,
    );
    const result = verifyAuditEventChain(auditHasher, events, {
      storedHeadHash: head.lastEventHash,
      ...(input.request.fromSequence !== undefined
        ? { expectedFirstSequence: input.request.fromSequence }
        : {}),
    });
    return verifyResponse({ workspaceId: input.workspaceId, result });
  }

  async getRunEvidence(input: {
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    workflowRunId: string;
  }): Promise<RunEvidenceResponse> {
    if (!READER_ROLES.has(input.role)) {
      throw new ForbiddenException('AUDIT_ACCESS_FORBIDDEN');
    }
    return runEvidenceResponse({
      workspaceId: '',
      workflowRunId: input.workflowRunId,
      events: [],
    });
  }

  async getRunEvidenceForRun(input: {
    actorUserId: string;
    workflowRunId: string;
  }): Promise<RunEvidenceResponse> {
    const probe = await this.repository.listAuditEvents({
      workspaceId: '',
      primaryEntityKind: WORKFLOW_RUN_ENTITY_KIND,
      primaryEntityId: input.workflowRunId,
      limit: 1_000,
    });
    const sample = probe.events[0];
    if (sample === undefined) {
      return runEvidenceResponse({
        workspaceId: '',
        workflowRunId: input.workflowRunId,
        events: [],
      });
    }
    const access = await this.recordingRepository.resolveWorkspaceAccess(
      input.actorUserId,
      sample.workspaceId,
    );
    if (access === null || !READER_ROLES.has(access.role)) {
      return runEvidenceResponse({
        workspaceId: sample.workspaceId,
        workflowRunId: input.workflowRunId,
        events: [],
      });
    }
    const allForRun = await this.repository.listAuditEvents({
      workspaceId: sample.workspaceId,
      primaryEntityKind: WORKFLOW_RUN_ENTITY_KIND,
      primaryEntityId: input.workflowRunId,
      limit: 1_000,
    });
    const stepEvents = await this.repository.listAuditEvents({
      workspaceId: sample.workspaceId,
      primaryEntityKind: WORKFLOW_RUN_STEP_ENTITY_KIND,
      limit: 1_000,
    });
    const merged = [...allForRun.events];
    for (const event of stepEvents.events) {
      const linked = event.relatedEntities.some(
        (related) =>
          related.kind === WORKFLOW_RUN_ENTITY_KIND &&
          related.id === input.workflowRunId,
      );
      if (linked) {
        merged.push(event);
      }
    }
    merged.sort((left, right) => left.sequence - right.sequence);
    return runEvidenceResponse({
      workspaceId: sample.workspaceId,
      workflowRunId: input.workflowRunId,
      events: merged,
    });
  }

  rethrowAuditTrailError(error: unknown): never {
    if (!(error instanceof AuditTrailError)) {
      throw error;
    }
    if (error.code === 'AUDIT_SOURCE_CONFLICT') {
      throw new ConflictException({
        code: 'AUDIT_SOURCE_CONFLICT',
        message:
          'An audit event with the same sourceId already exists with a conflicting payload.',
      });
    }
    throw new BadRequestException({
      code: error.code,
      message: 'The audit request was rejected.',
    });
  }
}