import type {
  ScheduleCreationResult,
  WorkflowScheduleAccess,
  WorkflowScheduleOccurrenceRecord,
  WorkflowScheduleRecord,
} from '@tasktwin/database';

import type {
  OccurrenceListResponse,
  WorkflowScheduleDetail,
  WorkflowScheduleListResponse,
  WorkflowScheduleOccurrenceResponse,
  WorkflowScheduleResponse,
} from './workflow-schedule.contracts.js';
import {
  OccurrenceListResponseSchema,
  WorkflowScheduleDetailSchema,
  WorkflowScheduleListResponseSchema,
  WorkflowScheduleOccurrenceResponseSchema,
  WorkflowScheduleResponseSchema,
} from './workflow-schedule.contracts.js';

function canManage(role: string): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function toDetail(record: WorkflowScheduleRecord): WorkflowScheduleDetail {
  return WorkflowScheduleDetailSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    workflowId: record.workflowId,
    workflowVersionId: record.workflowVersionId,
    workflowVersion: record.workflowVersion,
    runnerDeviceId: record.runnerDeviceId,
    clientScheduleId: record.clientScheduleId,
    name: record.name,
    definition: record.definition,
    definitionDigest: record.definitionDigest,
    workflowDigest: record.workflowDigest,
    status: record.status,
    overlapPolicy: record.overlapPolicy,
    misfirePolicy: record.misfirePolicy,
    maxStartDelaySeconds: record.maxStartDelaySeconds,
    nextOccurrenceAt: record.nextOccurrenceAt?.toISOString() ?? null,
    lastOccurrenceAt: record.lastOccurrenceAt?.toISOString() ?? null,
    autoPauseReason: record.autoPauseReason,
    autoPausedAt: record.autoPausedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

export function toWorkflowScheduleResponse(
  creationResult: ScheduleCreationResult,
): WorkflowScheduleResponse {
  return WorkflowScheduleResponseSchema.parse({
    schemaVersion: 1,
    schedule: toDetail(creationResult.schedule),
    nextOccurrenceAt:
      creationResult.nextOccurrenceAt?.toISOString() ?? null,
    ready: creationResult.ready,
    readinessIssues: creationResult.readinessIssues,
    idempotent: creationResult.idempotent,
  });
}

export function toWorkflowScheduleListResponse(
  records: WorkflowScheduleRecord[],
  access: WorkflowScheduleAccess,
): WorkflowScheduleListResponse {
  return WorkflowScheduleListResponseSchema.parse({
    schemaVersion: 1,
    workspaceId: access.workspaceId,
    access: {
      role: access.role,
      canManage: canManage(access.role),
    },
    schedules: records.map(toDetail),
  });
}

export function toOccurrenceResponse(
  record: WorkflowScheduleOccurrenceRecord,
): WorkflowScheduleOccurrenceResponse {
  return WorkflowScheduleOccurrenceResponseSchema.parse({
    id: record.id,
    scheduleId: record.scheduleId,
    workflowRunId: record.workflowRunId,
    scheduledFor: record.scheduledFor.toISOString(),
    startDeadlineAt: record.startDeadlineAt.toISOString(),
    status: record.status,
    skipReason: record.skipReason,
    skippedAt: record.skippedAt?.toISOString() ?? null,
    dispatchedAt: record.dispatchedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    terminationCause: record.terminationCause,
    createdAt: record.createdAt.toISOString(),
  });
}

export function toOccurrenceListResponse(
  scheduleId: string,
  records: WorkflowScheduleOccurrenceRecord[],
  nextCursor: string | null,
): OccurrenceListResponse {
  return OccurrenceListResponseSchema.parse({
    schemaVersion: 1,
    scheduleId,
    occurrences: records.map(toOccurrenceResponse),
    nextCursor,
  });
}
