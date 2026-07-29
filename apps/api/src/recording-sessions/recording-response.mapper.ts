import {
  RecordingEventBatchResponseSchema,
  RecordingSessionCompleteResponseSchema,
  RecordingSessionCreateResponseSchema,
  RecordingSessionMetadataResponseSchema,
  type RecordingEventBatchResponse,
  type RecordingSessionCompleteResponse,
  type RecordingSessionCreateResponse,
  type RecordingSessionMetadataResponse,
} from '@tasktwin/recording-schema';
import type {
  CompleteRecordingSessionResult,
  CreateRecordingSessionResult,
  IngestRecordingBatchResult,
  RecordingSessionMetadataRecord,
} from '@tasktwin/database';

export function toRecordingSessionCreateResponse(
  result: CreateRecordingSessionResult,
): RecordingSessionCreateResponse {
  return RecordingSessionCreateResponseSchema.parse({
    schemaVersion: 1,
    recordingSessionId: result.session.id,
    clientSessionId: result.session.clientSessionId,
    status: result.session.status,
    idempotent: result.idempotent,
  });
}

export function toRecordingEventBatchResponse(
  result: IngestRecordingBatchResult,
): RecordingEventBatchResponse {
  return RecordingEventBatchResponseSchema.parse({
    schemaVersion: 1,
    ...result,
  });
}

export function toRecordingSessionCompleteResponse(
  result: CompleteRecordingSessionResult,
): RecordingSessionCompleteResponse {
  return RecordingSessionCompleteResponseSchema.parse({
    schemaVersion: 1,
    ...result,
  });
}

export function toRecordingSessionMetadataResponse(
  record: RecordingSessionMetadataRecord,
): RecordingSessionMetadataResponse {
  return RecordingSessionMetadataResponseSchema.parse({
    schemaVersion: 1,
    recordingSessionId: record.id,
    clientSessionId: record.clientSessionId,
    workspaceId: record.workspaceId,
    createdByUserId: record.createdByUserId,
    status: record.status,
    targetOrigin: record.targetOrigin,
    startedAt: record.startedAt.toISOString(),
    stoppedAt: record.stoppedAt.toISOString(),
    eventCount: record.eventCount,
    lastSequence: record.lastSequence,
    receivedEventCount: record.receivedEventCount,
    receivedLastSequence: record.receivedLastSequence,
    privacySummary: record.privacySummary,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}
