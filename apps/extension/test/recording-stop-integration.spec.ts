import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_RECORDING_ARCHIVE_STORAGE_KEY,
  LOCAL_RECORDING_OUTBOX_STORAGE_KEY,
} from '../src/recording-artifacts/constants.js';
import {
  ChromeLocalRecordingArchive,
  type LocalRecordingStorageArea,
} from '../src/recording-artifacts/archive-store.js';
import { LocalRecordingArtifactFinalizer } from '../src/recording-artifacts/artifact-finalizer.js';
import type {
  RecorderStateChangedNotification,
  RecordingSessionState,
} from '../src/recorder/contracts.js';
import { RecorderController } from '../src/recorder/controller.js';
import type { RecordingTimeline } from '../src/recorder/event-contracts.js';
import type {
  ActiveTabProvider,
  ContentScriptCoordinator,
  RecorderClock,
  RecorderIdGenerator,
  RecordingStateStore,
  RecordingTimelineStore,
} from '../src/recorder/ports.js';
import {
  createRecordingEvent,
  recordingSessionId,
  recordingTimestamp,
} from './recording-artifact-fixture.js';

class FakeLocalStorage implements LocalRecordingStorageArea {
  readonly values: Record<string, unknown> = {};
  failSet = false;

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(
      key in this.values ? { [key]: structuredClone(this.values[key]) } : {},
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    if (this.failSet) {
      return Promise.reject(new Error('local storage unavailable'));
    }
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}

class FakeStateStore implements RecordingStateStore {
  readonly statuses: string[] = [];
  idleObservedAfterArchive = false;

  constructor(
    public stored: RecordingSessionState,
    private readonly localStorage: FakeLocalStorage,
  ) {}

  load(): Promise<unknown> {
    return Promise.resolve(this.stored);
  }

  save(state: RecordingSessionState): Promise<void> {
    if (state.status === 'idle') {
      this.idleObservedAfterArchive =
        this.localStorage.values[LOCAL_RECORDING_ARCHIVE_STORAGE_KEY] !==
          undefined &&
        this.localStorage.values[LOCAL_RECORDING_OUTBOX_STORAGE_KEY] !==
          undefined;
    }
    this.stored = structuredClone(state);
    this.statuses.push(state.status);
    return Promise.resolve();
  }
}

class FakeTimelineStore implements RecordingTimelineStore {
  constructor(public stored: RecordingTimeline) {}

  load(): Promise<unknown> {
    return Promise.resolve(this.stored);
  }

  save(timeline: RecordingTimeline): Promise<void> {
    this.stored = structuredClone(timeline);
    return Promise.resolve();
  }
}

function recordingState(): RecordingSessionState {
  return {
    schemaVersion: 1,
    status: 'recording',
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

function setup(localStorage = new FakeLocalStorage()) {
  const stateStore = new FakeStateStore(recordingState(), localStorage);
  const timelineStore = new FakeTimelineStore(timeline());
  const archive = new ChromeLocalRecordingArchive(localStorage);
  const contentScript = {
    prepare: vi.fn().mockResolvedValue(undefined),
    flushPending: vi.fn().mockResolvedValue({
      success: true,
      flushed: true,
    }),
    notify: vi
      .fn()
      .mockImplementation(
        (_tabId: number, notification: RecorderStateChangedNotification) =>
          Promise.resolve({
            success: true,
            receivedStatus: notification.state.status,
          }),
      ),
  } satisfies ContentScriptCoordinator;
  const clock = { now: () => recordingTimestamp } satisfies RecorderClock;
  const controller = new RecorderController(
    stateStore,
    timelineStore,
    {
      getActiveTab: () => Promise.resolve(null),
    } satisfies ActiveTabProvider,
    contentScript,
    clock,
    {
      createSessionId: () => recordingSessionId,
    } satisfies RecorderIdGenerator,
    new LocalRecordingArtifactFinalizer(timelineStore, archive),
  );
  return { archive, contentScript, controller, stateStore };
}

describe('durable recording stop lifecycle', () => {
  it('flushes and archives before reporting a saved idle state', async () => {
    const { archive, contentScript, controller, stateStore } = setup();

    const response = await controller.handle({ type: 'recorder/stop' });

    expect(response).toMatchObject({
      success: true,
      state: { status: 'idle' },
    });
    expect(contentScript.flushPending).toHaveBeenCalledBefore(
      contentScript.notify,
    );
    expect(stateStore.statuses).toEqual(['stopping', 'idle']);
    expect(stateStore.idleObservedAfterArchive).toBe(true);
    await expect(
      archive.loadArtifact(recordingSessionId),
    ).resolves.toMatchObject({
      clientSessionId: recordingSessionId,
      eventCount: 1,
    });
    await expect(
      archive.loadOutboxEntry(recordingSessionId),
    ).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('keeps the session and timeline recoverable when local persistence fails', async () => {
    const localStorage = new FakeLocalStorage();
    localStorage.failSet = true;
    const { controller, stateStore } = setup(localStorage);

    const response = await controller.handle({ type: 'recorder/stop' });

    expect(response).toMatchObject({
      success: false,
      error: { code: 'ARTIFACT_STORAGE_FAILURE' },
      state: {
        status: 'error',
        sessionId: recordingSessionId,
      },
    });
    expect(stateStore.statuses).toEqual(['stopping', 'error']);
    expect(stateStore.idleObservedAfterArchive).toBe(false);
  });
});
