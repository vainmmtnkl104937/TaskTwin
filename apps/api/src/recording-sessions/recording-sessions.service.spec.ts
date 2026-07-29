import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  RecordingRepositoryError,
  type RecordingRepository,
} from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { RecordingSessionsService } from './recording-sessions.service.js';

const actorUserId = '74c2fef6-54cb-438d-b343-77e4cfd19806';
const workspaceId = '74ef5779-b652-4dd2-88f8-2f88e1bbac71';
const recordingSessionId = 'd6eec35b-0ca5-4d63-84a3-83c45986b796';
const clientSessionId = '57a1a7d4-5ada-4bc8-ac17-10c84746a567';
const timestamp = '2026-07-29T10:00:00.000Z';

const emptyPrivacySummary = {
  schemaVersion: 1,
  totalEvents: 0,
  policyCounts: { allow: 0, mask: 0, block: 0 },
  sensitivityCounts: {
    public: 0,
    general: 0,
    personal: 0,
    authentication: 0,
    financial: 0,
    identity: 0,
    health: 0,
    unknownSensitive: 0,
  },
} as const;

const createRequest = {
  schemaVersion: 1,
  clientSessionId,
  targetOrigin: 'https://example.test',
  startedAt: timestamp,
  stoppedAt: timestamp,
  eventCount: 0,
  lastSequence: 0,
  privacySummary: emptyPrivacySummary,
} as const;

describe('RecordingSessionsService', () => {
  it('validates create metadata and maps a safe response', async () => {
    const createSession = vi.fn().mockResolvedValue({
      session: {
        id: recordingSessionId,
        clientSessionId,
        workspaceId,
        createdByUserId: actorUserId,
        status: 'receiving',
        targetOrigin: createRequest.targetOrigin,
        startedAt: new Date(timestamp),
        stoppedAt: new Date(timestamp),
        eventCount: 0,
        lastSequence: 0,
        receivedEventCount: 0,
        receivedLastSequence: 0,
        privacySummary: emptyPrivacySummary,
        completedAt: null,
        createdAt: new Date(timestamp),
        updatedAt: new Date(timestamp),
      },
      idempotent: false,
    });
    const service = new RecordingSessionsService({
      createSession,
    } as unknown as RecordingRepository);

    await expect(
      service.create(actorUserId, workspaceId, createRequest),
    ).resolves.toEqual({
      schemaVersion: 1,
      recordingSessionId,
      clientSessionId,
      status: 'receiving',
      idempotent: false,
    });
    expect(createSession).toHaveBeenCalledWith(
      actorUserId,
      workspaceId,
      createRequest,
    );
  });

  it('rejects unexpected request properties before repository access', async () => {
    const createSession = vi.fn();
    const service = new RecordingSessionsService({
      createSession,
    } as unknown as RecordingRepository);

    await expect(
      service.create(actorUserId, workspaceId, {
        ...createRequest,
        accessToken: 'must-not-be-accepted',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('maps inaccessible resources and conflicts to safe HTTP errors', async () => {
    const service = new RecordingSessionsService({
      getSessionMetadata: vi
        .fn()
        .mockRejectedValue(new RecordingRepositoryError('RECORDING_NOT_FOUND')),
      completeSession: vi
        .fn()
        .mockRejectedValue(
          new RecordingRepositoryError('INCOMPLETE_RECORDING'),
        ),
    } as unknown as RecordingRepository);

    await expect(
      service.getMetadata(actorUserId, recordingSessionId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.complete(actorUserId, recordingSessionId, {
        schemaVersion: 1,
        clientSessionId,
        eventCount: 0,
        lastSequence: 0,
        privacySummary: emptyPrivacySummary,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
