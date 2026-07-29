import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  RecordingRepositoryError,
  RecordingWorkflowConversionRepositoryError,
  type RecordingRepository,
  type RecordingWorkflowConversionRepository,
} from '@tasktwin/database';
import validRecordingArtifact from '@tasktwin/recording-schema/fixtures/valid-recording-artifact.v1.json' with { type: 'json' };
import { describe, expect, it, vi } from 'vitest';

import { RecordingWorkflowDraftsService } from './recording-workflow-drafts.service.js';

const actorUserId = '74c2fef6-54cb-438d-b343-77e4cfd19806';
const workspaceId = '74ef5779-b652-4dd2-88f8-2f88e1bbac71';
const recordingSessionId = 'd6eec35b-0ca5-4d63-84a3-83c45986b796';
const clientConversionId = '57a1a7d4-5ada-4bc8-ac17-10c84746a567';
const workflowVersionId = 'a2adad18-8e09-40ac-9224-44e17717acc0';

const emptyArtifact = {
  schemaVersion: 1,
  clientSessionId: '11111111-1111-4111-8111-111111111111',
  targetOrigin: 'https://example.test',
  startedAt: '2026-07-29T10:00:00.000Z',
  stoppedAt: '2026-07-29T10:01:00.000Z',
  eventCount: 0,
  lastSequence: 0,
  events: [],
  privacySummary: {
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
  },
} as const;

function setup(artifact: unknown = validRecordingArtifact) {
  const getCompletedArtifactForConversion = vi.fn().mockResolvedValue({
    recordingSessionId,
    workspaceId,
    artifact,
  });
  const createDraft = vi.fn().mockImplementation(
    (
      _actorUserId: string,
      persistedRecordingSessionId: string,
      persistedClientConversionId: string,
      _options: unknown,
      conversion: {
        outcome: 'draft';
        workflowDefinition: {
          workflowId: string;
        };
        report: unknown;
      },
    ) =>
      Promise.resolve({
        conversion: {
          id: 'b267e4cc-9936-42e0-8f72-f6fd8b03f5a5',
          recordingSessionId: persistedRecordingSessionId,
          clientConversionId: persistedClientConversionId,
          workflowId: conversion.workflowDefinition.workflowId,
          workflowVersionId,
          createdById: actorUserId,
          report: conversion.report,
          workflowDefinition: conversion.workflowDefinition,
          createdAt: new Date('2026-07-29T12:00:00.000Z'),
        },
        idempotent: false,
      }),
  );

  const service = new RecordingWorkflowDraftsService(
    {
      getCompletedArtifactForConversion,
    } as unknown as RecordingRepository,
    {
      createDraft,
    } as unknown as RecordingWorkflowConversionRepository,
  );

  return { createDraft, getCompletedArtifactForConversion, service };
}

describe('RecordingWorkflowDraftsService', () => {
  it('converts a completed artifact and returns only a safe draft summary', async () => {
    const { createDraft, service } = setup();

    const response = await service.create(actorUserId, recordingSessionId, {
      clientConversionId,
      name: 'Recorded customer setup',
      description: 'Draft generated from a completed recording.',
    });

    expect(response).toMatchObject({
      schemaVersion: 1,
      recordingSessionId,
      clientConversionId,
      workflowVersionId,
      version: 1,
      status: 'draft',
      idempotent: false,
    });
    expect(response.workflowId).toMatch(/^workflow-/);
    expect(response.generatedStepCount).toBeGreaterThan(0);
    expect(createDraft).toHaveBeenCalledWith(
      actorUserId,
      recordingSessionId,
      clientConversionId,
      expect.objectContaining({
        schemaVersion: 1,
        workflowName: 'Recorded customer setup',
      }),
      expect.objectContaining({
        schemaVersion: 1,
        outcome: 'draft',
      }),
    );

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('events');
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('locatorBundle');
    expect(serialized).not.toContain('workflowDefinition');
    expect(serialized).not.toContain('secretName');
  });

  it.each([
    {
      label: 'an unexpected property',
      input: {
        clientConversionId,
        name: 'Recorded customer setup',
        accessToken: 'must-not-be-accepted',
      },
    },
    {
      label: 'an invalid conversion identifier',
      input: {
        clientConversionId: 'not-a-uuid',
        name: 'Recorded customer setup',
      },
    },
    {
      label: 'an empty workflow name',
      input: { clientConversionId, name: '   ' },
    },
    {
      label: 'an empty optional description',
      input: {
        clientConversionId,
        name: 'Recorded customer setup',
        description: '   ',
      },
    },
  ])('rejects $label before repository access', async ({ input }) => {
    const { createDraft, getCompletedArtifactForConversion, service } = setup();

    await expect(
      service.create(actorUserId, recordingSessionId, input),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(getCompletedArtifactForConversion).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('returns a safe unprocessable response when no step can be generated', async () => {
    const { createDraft, service } = setup(emptyArtifact);

    await expect(
      service.create(actorUserId, recordingSessionId, {
        clientConversionId,
        name: 'Empty recording',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('maps incomplete recordings and conversion conflicts to safe conflicts', async () => {
    const incomplete = setup();
    incomplete.getCompletedArtifactForConversion.mockRejectedValue(
      new RecordingRepositoryError('RECORDING_NOT_COMPLETED'),
    );

    await expect(
      incomplete.service.create(actorUserId, recordingSessionId, {
        clientConversionId,
        name: 'Incomplete recording',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const conflicting = setup();
    conflicting.createDraft.mockRejectedValue(
      new RecordingWorkflowConversionRepositoryError('CONVERSION_CONFLICT'),
    );
    await expect(
      conflicting.service.create(actorUserId, recordingSessionId, {
        clientConversionId,
        name: 'Conflicting conversion',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
