import {
  createRecordingPrivacySummary,
  RecordingArtifactSchema,
} from '@tasktwin/recording-schema';

import type {
  RecorderErrorCode,
  RecordingSessionState,
} from '../recorder/contracts.js';
import { RecordingTimelineSchema } from '../recorder/event-contracts.js';
import type { RecordingTimelineStore } from '../recorder/ports.js';
import {
  LocalRecordingStorageError,
  type LocalRecordingStorageErrorCode,
  type RecordingArtifactArchive,
} from './archive-store.js';

export class RecordingFinalizationError extends Error {
  constructor(readonly code: RecorderErrorCode) {
    super(code);
    this.name = 'RecordingFinalizationError';
  }
}

const STORAGE_ERROR_CODES = {
  INVALID_LOCAL_RECORDING_STORAGE: 'ARTIFACT_STORAGE_FAILURE',
  LOCAL_RECORDING_ARTIFACT_TOO_LARGE: 'ARTIFACT_TOO_LARGE',
  LOCAL_RECORDING_ARCHIVE_LIMIT_REACHED: 'ARTIFACT_LIMIT_REACHED',
  LOCAL_RECORDING_OUTBOX_LIMIT_REACHED: 'ARTIFACT_LIMIT_REACHED',
  LOCAL_RECORDING_ARCHIVE_TOO_LARGE: 'ARTIFACT_LIMIT_REACHED',
  LOCAL_RECORDING_ARTIFACT_CONFLICT: 'ARTIFACT_CONFLICT',
  LOCAL_RECORDING_STORAGE_FAILURE: 'ARTIFACT_STORAGE_FAILURE',
} as const satisfies Record<LocalRecordingStorageErrorCode, RecorderErrorCode>;

export interface RecordingArtifactFinalizer {
  finalize(state: RecordingSessionState): Promise<void>;
}

export class LocalRecordingArtifactFinalizer implements RecordingArtifactFinalizer {
  constructor(
    private readonly timelineStore: RecordingTimelineStore,
    private readonly archive: RecordingArtifactArchive,
  ) {}

  async finalize(state: RecordingSessionState): Promise<void> {
    if (
      state.status !== 'stopping' ||
      state.sessionId === null ||
      state.targetOrigin === null ||
      state.startedAt === null
    ) {
      throw new RecordingFinalizationError('ARTIFACT_INVALID');
    }

    let storedTimeline: unknown;
    try {
      storedTimeline = await this.timelineStore.load();
    } catch {
      throw new RecordingFinalizationError('ARTIFACT_STORAGE_FAILURE');
    }

    const parsedTimeline = RecordingTimelineSchema.safeParse(storedTimeline);
    if (
      !parsedTimeline.success ||
      parsedTimeline.data.sessionId !== state.sessionId
    ) {
      throw new RecordingFinalizationError('ARTIFACT_INVALID');
    }

    const timeline = parsedTimeline.data;
    const artifactResult = RecordingArtifactSchema.safeParse({
      schemaVersion: 1,
      clientSessionId: state.sessionId,
      targetOrigin: state.targetOrigin,
      startedAt: state.startedAt,
      stoppedAt: state.lastUpdatedAt,
      eventCount: timeline.events.length,
      lastSequence: timeline.events.at(-1)?.sequence ?? 0,
      events: timeline.events,
      privacySummary: createRecordingPrivacySummary(timeline.events),
    });
    if (!artifactResult.success) {
      throw new RecordingFinalizationError('ARTIFACT_INVALID');
    }

    try {
      await this.archive.finalize(artifactResult.data, state.lastUpdatedAt);
    } catch (error: unknown) {
      if (error instanceof LocalRecordingStorageError) {
        throw new RecordingFinalizationError(STORAGE_ERROR_CODES[error.code]);
      }
      throw new RecordingFinalizationError('ARTIFACT_STORAGE_FAILURE');
    }
  }
}
