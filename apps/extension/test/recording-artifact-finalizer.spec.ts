import { describe, expect, it } from 'vitest';

import type { RecordingSessionState } from '../src/recorder/contracts.js';
import type { RecordingTimeline } from '../src/recorder/event-contracts.js';
import type { RecordingTimelineStore } from '../src/recorder/ports.js';
import {
  ChromeLocalRecordingArchive,
  type LocalRecordingStorageArea,
} from '../src/recording-artifacts/archive-store.js';
import {
  LocalRecordingArtifactFinalizer,
  RecordingFinalizationError,
} from '../src/recording-artifacts/artifact-finalizer.js';
import {
  createRecordingEvent,
  recordingSessionId,
  recordingTimestamp,
} from './recording-artifact-fixture.js';

class FakeTimelineStore implements RecordingTimelineStore {
  constructor(
    private readonly value: unknown,
    private readonly failLoad = false,
  ) {}

  load(): Promise<unknown | undefined> {
    return this.failLoad
      ? Promise.reject(new Error('session storage unavailable'))
      : Promise.resolve(this.value);
  }

  save(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeLocalStorage implements LocalRecordingStorageArea {
  readonly values: Record<string, unknown> = {};

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(
      key in this.values ? { [key]: structuredClone(this.values[key]) } : {},
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}

function stoppingState(): RecordingSessionState {
  return {
    schemaVersion: 1,
    status: 'stopping',
    sessionId: recordingSessionId,
    activeTabId: 42,
    activeWindowId: 7,
    targetOrigin: 'https://example.com',
    startedAt: recordingTimestamp,
    pausedAt: null,
    lastUpdatedAt: recordingTimestamp,
    error: null,
  };
}

function timeline(): RecordingTimeline {
  return {
    schemaVersion: 3,
    sessionId: recordingSessionId,
    nextSequence: 2,
    events: [createRecordingEvent()],
  };
}

describe('recording artifact finalization', () => {
  it('validates the full v3 timeline before creating the durable artifact', async () => {
    const archive = new ChromeLocalRecordingArchive(new FakeLocalStorage());
    const finalizer = new LocalRecordingArtifactFinalizer(
      new FakeTimelineStore(timeline()),
      archive,
    );

    await finalizer.finalize(stoppingState());

    await expect(
      archive.loadArtifact(recordingSessionId),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      clientSessionId: recordingSessionId,
      targetOrigin: 'https://example.com',
      eventCount: 1,
      lastSequence: 1,
    });
    await expect(
      archive.loadOutboxEntry(recordingSessionId),
    ).resolves.toMatchObject({
      status: 'pending',
      attemptCount: 0,
    });
  });

  it('rejects a legacy or mismatched timeline instead of upgrading it', async () => {
    const finalizer = new LocalRecordingArtifactFinalizer(
      new FakeTimelineStore({
        schemaVersion: 2,
        sessionId: recordingSessionId,
        nextSequence: 1,
        events: [],
      }),
      new ChromeLocalRecordingArchive(new FakeLocalStorage()),
    );

    await expect(finalizer.finalize(stoppingState())).rejects.toEqual(
      new RecordingFinalizationError('ARTIFACT_INVALID'),
    );
  });

  it('maps session timeline storage failure to a safe typed error', async () => {
    const finalizer = new LocalRecordingArtifactFinalizer(
      new FakeTimelineStore(undefined, true),
      new ChromeLocalRecordingArchive(new FakeLocalStorage()),
    );

    await expect(finalizer.finalize(stoppingState())).rejects.toEqual(
      new RecordingFinalizationError('ARTIFACT_STORAGE_FAILURE'),
    );
  });
});
