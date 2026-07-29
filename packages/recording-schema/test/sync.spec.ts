import { describe, expect, it } from 'vitest';

import {
  MAX_RECORDING_BATCH_EVENTS,
  RecordingEventBatchResponseSchema,
  RecordingEventBatchSchema,
  RecordingSessionCompleteRequestSchema,
  RecordingSessionCompleteResponseSchema,
  RecordingSessionCreateRequestSchema,
  RecordingSessionCreateResponseSchema,
  RecordingSessionMetadataResponseSchema,
  type RecordingArtifact,
} from '../src/index.js';
import { loadValidRecordingArtifact } from './fixture.js';

function createRequest(artifact: RecordingArtifact) {
  return {
    schemaVersion: 1 as const,
    clientSessionId: artifact.clientSessionId,
    targetOrigin: artifact.targetOrigin,
    startedAt: artifact.startedAt,
    stoppedAt: artifact.stoppedAt,
    eventCount: artifact.eventCount,
    lastSequence: artifact.lastSequence,
    privacySummary: artifact.privacySummary,
  };
}

function eventBatch(artifact: RecordingArtifact) {
  return {
    schemaVersion: 1 as const,
    clientSessionId: artifact.clientSessionId,
    clientBatchId: 'fixture-batch-001',
    eventCount: artifact.events.length,
    firstSequence: artifact.events[0]?.sequence ?? 1,
    lastSequence: artifact.events.at(-1)?.sequence ?? 1,
    events: artifact.events,
  };
}

function completeRequest(artifact: RecordingArtifact) {
  return {
    schemaVersion: 1 as const,
    clientSessionId: artifact.clientSessionId,
    eventCount: artifact.eventCount,
    lastSequence: artifact.lastSequence,
    privacySummary: artifact.privacySummary,
  };
}

function batchEventId(index: number): string {
  const suffix = index.toString(16).padStart(12, '0');
  return `99999999-9999-4999-8999-${suffix}`;
}

describe('RecordingSessionCreateRequestSchema', () => {
  it('accepts an artifact header without raw events', () => {
    const request = createRequest(loadValidRecordingArtifact());

    expect(RecordingSessionCreateRequestSchema.parse(request)).toEqual(request);
    expect(request).not.toHaveProperty('events');
  });

  it('rejects inconsistent declared counts', () => {
    const request = createRequest(loadValidRecordingArtifact());
    request.lastSequence = 2;

    expect(RecordingSessionCreateRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });

  it('rejects unexpected properties', () => {
    const request = {
      ...createRequest(loadValidRecordingArtifact()),
      accessToken: 'not-accepted',
    };

    expect(RecordingSessionCreateRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });
});

describe('RecordingEventBatchSchema', () => {
  it('accepts an ordered bounded batch', () => {
    const batch = eventBatch(loadValidRecordingArtifact());

    expect(RecordingEventBatchSchema.parse(batch)).toEqual(batch);
  });

  it('rejects a mismatched declared event count', () => {
    const batch = eventBatch(loadValidRecordingArtifact());
    batch.eventCount = 2;

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(false);
  });

  it('rejects first and last sequence mismatches', () => {
    const batch = eventBatch(loadValidRecordingArtifact());
    batch.firstSequence = 2;
    batch.lastSequence = 2;

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(false);
  });

  it('rejects sequence gaps', () => {
    const batch = eventBatch(loadValidRecordingArtifact());
    const second = batch.events[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    second.sequence = 4;

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(false);
  });

  it('rejects a mismatched client session', () => {
    const batch = eventBatch(loadValidRecordingArtifact());
    const second = batch.events[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    second.sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(false);
  });

  it('rejects duplicate event IDs', () => {
    const batch = eventBatch(loadValidRecordingArtifact());
    const first = batch.events[0];
    const second = batch.events[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    second.eventId = first.eventId;

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(false);
  });

  it('enforces the maximum batch size', () => {
    const batch = eventBatch(loadValidRecordingArtifact());
    batch.events = Array.from({ length: MAX_RECORDING_BATCH_EVENTS + 1 }, () =>
      structuredClone(batch.events[0]!),
    );
    batch.eventCount = batch.events.length;

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(false);
  });

  it('accepts exactly the maximum number of unique contiguous events', () => {
    const artifact = loadValidRecordingArtifact();
    const base = artifact.events[0];
    expect(base).toBeDefined();
    if (base === undefined) return;

    const events = Array.from(
      { length: MAX_RECORDING_BATCH_EVENTS },
      (_, index) => ({
        ...structuredClone(base),
        eventId: batchEventId(index + 1),
        sequence: index + 1,
      }),
    );
    const batch = {
      schemaVersion: 1,
      clientSessionId: artifact.clientSessionId,
      clientBatchId: 'fixture-batch-at-limit',
      eventCount: events.length,
      firstSequence: 1,
      lastSequence: events.length,
      events,
    };

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('enforces the bounded client batch identifier', () => {
    const batch = eventBatch(loadValidRecordingArtifact());
    batch.clientBatchId = 'x'.repeat(129);

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(false);
  });

  it('rejects unexpected batch properties', () => {
    const batch = {
      ...eventBatch(loadValidRecordingArtifact()),
      authorization: 'not-accepted',
    };

    expect(RecordingEventBatchSchema.safeParse(batch).success).toBe(false);
  });
});

describe('RecordingSessionCompleteRequestSchema', () => {
  it('accepts matching completion declarations', () => {
    const request = completeRequest(loadValidRecordingArtifact());

    expect(RecordingSessionCompleteRequestSchema.parse(request)).toEqual(
      request,
    );
  });

  it('rejects mismatched summary and event declarations', () => {
    const request = completeRequest(loadValidRecordingArtifact());
    request.eventCount = 2;
    request.lastSequence = 2;

    expect(
      RecordingSessionCompleteRequestSchema.safeParse(request).success,
    ).toBe(false);
  });
});

describe('safe synchronization responses', () => {
  const recordingSessionId = '55555555-5555-4555-8555-555555555555';
  const workspaceId = '66666666-6666-4666-8666-666666666666';
  const userId = '77777777-7777-4777-8777-777777777777';

  it('validates create, batch, and completion responses', () => {
    const artifact = loadValidRecordingArtifact();

    expect(
      RecordingSessionCreateResponseSchema.safeParse({
        schemaVersion: 1,
        recordingSessionId,
        clientSessionId: artifact.clientSessionId,
        status: 'receiving',
        idempotent: false,
      }).success,
    ).toBe(true);

    expect(
      RecordingEventBatchResponseSchema.safeParse({
        schemaVersion: 1,
        recordingSessionId,
        clientBatchId: 'fixture-batch-001',
        status: 'receiving',
        acceptedEventCount: 3,
        receivedEventCount: 3,
        receivedLastSequence: 3,
        idempotent: false,
      }).success,
    ).toBe(true);

    expect(
      RecordingSessionCompleteResponseSchema.safeParse({
        schemaVersion: 1,
        recordingSessionId,
        clientSessionId: artifact.clientSessionId,
        status: 'completed',
        eventCount: 3,
        lastSequence: 3,
        idempotent: false,
      }).success,
    ).toBe(true);
  });

  it('validates safe metadata without exposing events', () => {
    const artifact = loadValidRecordingArtifact();
    const response = {
      schemaVersion: 1,
      recordingSessionId,
      clientSessionId: artifact.clientSessionId,
      workspaceId,
      createdByUserId: userId,
      status: 'completed',
      targetOrigin: artifact.targetOrigin,
      startedAt: artifact.startedAt,
      stoppedAt: artifact.stoppedAt,
      eventCount: artifact.eventCount,
      lastSequence: artifact.lastSequence,
      receivedEventCount: artifact.eventCount,
      receivedLastSequence: artifact.lastSequence,
      privacySummary: artifact.privacySummary,
      completedAt: artifact.stoppedAt,
      createdAt: artifact.startedAt,
      updatedAt: artifact.stoppedAt,
    };

    expect(RecordingSessionMetadataResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(response).not.toHaveProperty('events');
  });

  it('rejects raw events added to metadata responses', () => {
    const artifact = loadValidRecordingArtifact();
    const response = {
      schemaVersion: 1,
      recordingSessionId,
      clientSessionId: artifact.clientSessionId,
      workspaceId,
      createdByUserId: userId,
      status: 'receiving',
      targetOrigin: artifact.targetOrigin,
      startedAt: artifact.startedAt,
      stoppedAt: artifact.stoppedAt,
      eventCount: artifact.eventCount,
      lastSequence: artifact.lastSequence,
      receivedEventCount: 0,
      receivedLastSequence: 0,
      privacySummary: artifact.privacySummary,
      completedAt: null,
      createdAt: artifact.startedAt,
      updatedAt: artifact.stoppedAt,
      events: artifact.events,
    };

    expect(
      RecordingSessionMetadataResponseSchema.safeParse(response).success,
    ).toBe(false);
  });
});
