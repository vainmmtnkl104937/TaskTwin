import { describe, expect, it, vi } from 'vitest';

import type {
  ActiveTab,
  ActiveTabProvider,
  ContentScriptCoordinator,
  RecorderClock,
  RecorderIdGenerator,
  RecordingStateStore,
  RecordingTimelineStore,
} from '../src/recorder/ports.js';
import {
  createInitialRecordingState,
  transitionRecordingState,
} from '../src/recorder/state-machine.js';
import type {
  RecorderStateChangedNotification,
  RecordingSessionState,
} from '../src/recorder/contracts.js';
import { RecorderController } from '../src/recorder/controller.js';
import type { RecordingTimeline } from '../src/recorder/event-contracts.js';
import {
  RecordingFinalizationError,
  type RecordingArtifactFinalizer,
} from '../src/recording-artifacts/artifact-finalizer.js';

const timestamp = '2026-07-29T10:00:00.000Z';
const sessionId = '57a1a7d4-5ada-4bc8-ac17-10c84746a567';

class FakeStateStore implements RecordingStateStore {
  readonly saves: RecordingSessionState[] = [];
  failLoad = false;
  failSave = false;

  constructor(public stored: unknown | undefined) {}

  load(): Promise<unknown | undefined> {
    if (this.failLoad) {
      return Promise.reject(new Error('storage unavailable'));
    }
    return Promise.resolve(this.stored);
  }

  save(state: RecordingSessionState): Promise<void> {
    if (this.failSave) {
      return Promise.reject(new Error('storage unavailable'));
    }
    this.stored = structuredClone(state);
    this.saves.push(structuredClone(state));
    return Promise.resolve();
  }
}

class FakeTimelineStore implements RecordingTimelineStore {
  readonly saves: RecordingTimeline[] = [];
  stored: unknown | undefined;

  load(): Promise<unknown | undefined> {
    return Promise.resolve(this.stored);
  }

  save(timeline: RecordingTimeline): Promise<void> {
    this.stored = structuredClone(timeline);
    this.saves.push(structuredClone(timeline));
    return Promise.resolve();
  }
}

function createController(options?: {
  stored?: unknown;
  storedTimeline?: unknown;
  activeTab?: ActiveTab | null;
  notifyResponse?: unknown;
  finalizationError?: ConstructorParameters<
    typeof RecordingFinalizationError
  >[0];
}) {
  const store = new FakeStateStore(options?.stored);
  const timelineStore = new FakeTimelineStore();
  timelineStore.stored = options?.storedTimeline;
  const activeTabProvider = {
    getActiveTab: vi.fn().mockResolvedValue(
      options?.activeTab === undefined
        ? {
            id: 42,
            windowId: 7,
            url: 'https://example.com/private/path?secret=not-stored',
          }
        : options.activeTab,
    ),
  } satisfies ActiveTabProvider;
  const contentScript = {
    prepare: vi.fn().mockResolvedValue(undefined),
    notify: vi
      .fn()
      .mockImplementation(
        (_tabId: number, notification: RecorderStateChangedNotification) =>
          Promise.resolve(
            options?.notifyResponse ?? {
              success: true,
              receivedStatus: notification.state.status,
            },
          ),
      ),
    flushPending: vi.fn().mockResolvedValue({
      success: true,
      flushed: true,
    }),
  } satisfies ContentScriptCoordinator;
  const clock = { now: () => timestamp } satisfies RecorderClock;
  const idGenerator = {
    createSessionId: () => sessionId,
  } satisfies RecorderIdGenerator;
  const artifactFinalizer = {
    finalize: vi
      .fn()
      .mockImplementation(() =>
        options?.finalizationError === undefined
          ? Promise.resolve()
          : Promise.reject(
              new RecordingFinalizationError(options.finalizationError),
            ),
      ),
  } satisfies RecordingArtifactFinalizer;

  return {
    store,
    timelineStore,
    activeTabProvider,
    contentScript,
    artifactFinalizer,
    controller: new RecorderController(
      store,
      timelineStore,
      activeTabProvider,
      contentScript,
      clock,
      idGenerator,
      artifactFinalizer,
    ),
  };
}

function createRecordingState(): RecordingSessionState {
  const initial = createInitialRecordingState(timestamp);
  const starting = transitionRecordingState(
    initial,
    { type: 'start', sessionId },
    timestamp,
  );
  if (!starting.success) {
    throw new Error('Expected starting state');
  }
  const recording = transitionRecordingState(
    starting.state,
    {
      type: 'complete-start',
      activeTabId: 42,
      activeWindowId: 7,
      targetOrigin: 'https://example.com',
    },
    timestamp,
  );
  if (!recording.success) {
    throw new Error('Expected recording state');
  }
  return recording.state;
}

describe('RecorderController', () => {
  it('starts with a supported active tab and stores only its origin', async () => {
    const { controller, store, timelineStore, contentScript } =
      createController({
        storedTimeline: {
          schemaVersion: 1,
          sessionId: '00000000-0000-4000-8000-000000000000',
          nextSequence: 2,
          events: [
            {
              schemaVersion: 1,
              sessionId: '00000000-0000-4000-8000-000000000000',
              eventId: '00000000-0000-4000-8000-000000000001',
              sequence: 1,
              tabId: 1,
              origin: 'https://old.example',
              occurredAt: timestamp,
              recordedAt: timestamp,
              eventType: 'click',
              target: { tagName: 'button' },
              payload: { activation: 'primary' },
            },
          ],
        },
      });

    const response = await controller.handle({ type: 'recorder/start' });

    expect(response.success).toBe(true);
    expect(response.state).toMatchObject({
      status: 'recording',
      activeTabId: 42,
      activeWindowId: 7,
      targetOrigin: 'https://example.com',
    });
    expect(store.saves.map((state) => state.status)).toEqual([
      'idle',
      'starting',
      'recording',
    ]);
    expect(contentScript.prepare).toHaveBeenCalledWith(42);
    expect(timelineStore.saves).toEqual([
      {
        schemaVersion: 3,
        sessionId,
        nextSequence: 1,
        events: [],
      },
    ]);
    expect(contentScript.notify).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        type: 'recorder/state-changed',
        state: expect.objectContaining({ status: 'recording' }),
      }),
    );
    expect(JSON.stringify(store.stored)).not.toContain('/private/path');
  });

  it('returns a stable error when no active tab exists', async () => {
    const { controller, store, contentScript } = createController({
      activeTab: null,
    });

    const response = await controller.handle({ type: 'recorder/start' });

    expect(response).toMatchObject({
      success: false,
      error: { code: 'NO_ACTIVE_TAB' },
      state: { status: 'error' },
    });
    expect(store.saves.map((state) => state.status)).toEqual([
      'idle',
      'starting',
      'error',
    ]);
    expect(contentScript.prepare).not.toHaveBeenCalled();
  });

  it.each([
    'chrome://extensions',
    'chrome-extension://extension-id/popup.html',
    'edge://settings',
    'about:blank',
    'view-source:https://example.com',
  ])('rejects the unsupported page %s', async (url) => {
    const { controller, store, contentScript } = createController({
      activeTab: { id: 42, windowId: 7, url },
    });

    const response = await controller.handle({ type: 'recorder/start' });

    expect(response).toMatchObject({
      success: false,
      error: { code: 'UNSUPPORTED_PAGE' },
      state: { status: 'error' },
    });
    expect((store.stored as RecordingSessionState).status).toBe('error');
    expect(contentScript.prepare).not.toHaveBeenCalled();
  });

  it('does not mutate stored state when a transition is invalid', async () => {
    const recording = createRecordingState();
    const { controller, store } = createController({ stored: recording });

    const response = await controller.handle({ type: 'recorder/start' });

    expect(response).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION' },
      state: { status: 'recording' },
    });
    expect(store.saves).toHaveLength(0);
    expect(store.stored).toEqual(recording);
  });

  it('returns a storage error without committing the transition', async () => {
    const idle = createInitialRecordingState(timestamp);
    const { controller, store } = createController({ stored: idle });
    store.failSave = true;

    const response = await controller.handle({ type: 'recorder/start' });

    expect(response).toMatchObject({
      success: false,
      error: { code: 'STORAGE_FAILURE' },
      state: { status: 'idle' },
    });
    expect(store.stored).toEqual(idle);
    expect(store.saves).toHaveLength(0);
  });

  it('turns an interrupted transitional state into a persisted error', async () => {
    const idle = createInitialRecordingState(timestamp);
    const starting = transitionRecordingState(
      idle,
      { type: 'start', sessionId },
      timestamp,
    );
    if (!starting.success) {
      throw new Error('Expected starting state');
    }
    const { controller, store } = createController({
      stored: starting.state,
    });

    const response = await controller.handle({
      type: 'recorder/get-state',
    });

    expect(response).toMatchObject({
      success: true,
      state: { status: 'error', error: { code: 'UNKNOWN_ERROR' } },
    });
    expect(store.saves).toHaveLength(1);
  });

  it('persists pause and notifies the bound content script', async () => {
    const recording = createRecordingState();
    const { controller, store, contentScript } = createController({
      stored: recording,
      notifyResponse: { success: true, receivedStatus: 'paused' },
    });

    const response = await controller.handle({ type: 'recorder/pause' });

    expect(response).toMatchObject({
      success: true,
      state: { status: 'paused' },
    });
    expect(store.saves.map((state) => state.status)).toEqual(['paused']);
    expect(contentScript.flushPending).toHaveBeenCalledWith(42, {
      type: 'recorder/flush-pending',
      sessionId,
      reason: 'pause',
    });
    expect(contentScript.notify).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        state: expect.objectContaining({ status: 'paused' }),
      }) as RecorderStateChangedNotification,
    );
  });

  it('stops a paused recording and persists stopping and idle states', async () => {
    const recording = createRecordingState();
    const paused = transitionRecordingState(
      recording,
      { type: 'pause' },
      timestamp,
    );
    if (!paused.success) {
      throw new Error('Expected paused state');
    }
    const { controller, store, contentScript, artifactFinalizer } =
      createController({
        stored: paused.state,
      });

    const response = await controller.handle({ type: 'recorder/stop' });

    expect(response).toMatchObject({
      success: true,
      state: { status: 'idle' },
    });
    expect(store.saves.map((state) => state.status)).toEqual([
      'stopping',
      'idle',
    ]);
    expect(contentScript.flushPending).toHaveBeenCalledWith(42, {
      type: 'recorder/flush-pending',
      sessionId,
      reason: 'stop',
    });
    expect(contentScript.notify).toHaveBeenCalledTimes(2);
    expect(artifactFinalizer.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'stopping',
        sessionId,
      }),
    );
  });

  it('does not report stop success when durable finalization fails', async () => {
    const recording = createRecordingState();
    const { controller, store, artifactFinalizer } = createController({
      stored: recording,
      finalizationError: 'ARTIFACT_STORAGE_FAILURE',
    });

    const response = await controller.handle({ type: 'recorder/stop' });

    expect(response).toMatchObject({
      success: false,
      error: { code: 'ARTIFACT_STORAGE_FAILURE' },
      state: {
        status: 'error',
        sessionId,
      },
    });
    expect(store.saves.map((state) => state.status)).toEqual([
      'stopping',
      'error',
    ]);
    expect(artifactFinalizer.finalize).toHaveBeenCalledTimes(1);
  });

  it('recovers an interrupted stopping state before reporting idle', async () => {
    const recording = createRecordingState();
    const stopping = transitionRecordingState(
      recording,
      { type: 'stop' },
      timestamp,
    );
    if (!stopping.success) {
      throw new Error('Expected stopping state');
    }
    const { controller, store, artifactFinalizer } = createController({
      stored: stopping.state,
    });

    const response = await controller.handle({ type: 'recorder/get-state' });

    expect(response).toMatchObject({
      success: true,
      state: { status: 'idle' },
    });
    expect(artifactFinalizer.finalize).toHaveBeenCalledWith(stopping.state);
    expect(store.saves.map((state) => state.status)).toEqual(['idle']);
  });

  it('rejects a mismatched content acknowledgement safely', async () => {
    const { controller } = createController({
      notifyResponse: {
        success: true,
        receivedStatus: 'paused',
      },
    });

    const response = await controller.handle({ type: 'recorder/start' });

    expect(response).toMatchObject({
      success: false,
      error: { code: 'CONTENT_SCRIPT_UNAVAILABLE' },
      state: { status: 'error' },
    });
  });

  it('persists a safe error when content acknowledgement is invalid', async () => {
    const recording = createRecordingState();
    const { controller, store } = createController({
      stored: recording,
      notifyResponse: { acknowledged: true },
    });

    const response = await controller.handle({ type: 'recorder/pause' });

    expect(response).toMatchObject({
      success: false,
      error: { code: 'CONTENT_SCRIPT_UNAVAILABLE' },
      state: { status: 'error' },
    });
    expect(store.saves.map((state) => state.status)).toEqual([
      'paused',
      'error',
    ]);
  });
});
