import { describe, expect, it } from 'vitest';

import {
  createInitialRecordingState,
  transitionRecordingState,
} from '../src/recorder/state-machine.js';
import type {
  EventIdGenerator,
  RecorderClock,
  RecordingStateStore,
  RecordingTimelineStore,
} from '../src/recorder/ports.js';
import type { RecordingSessionState } from '../src/recorder/contracts.js';
import {
  MAX_RECORDING_EVENTS,
  type RecordingEvent,
  type RecordingTimeline,
} from '../src/recorder/event-contracts.js';
import {
  RecordingEventController,
  type RecordingEventSenderContext,
} from '../src/recorder/event-controller.js';
import { createRecordingTimeline } from '../src/recorder/timeline.js';
import { locatorBundleFixture } from './locator-fixture.js';

const timestamp = '2026-07-29T10:00:00.000Z';
const sessionId = '57a1a7d4-5ada-4bc8-ac17-10c84746a567';
const eventId = 'a5ebf13e-49e5-476f-98a5-9c376cf013d4';

class FakeStateStore implements RecordingStateStore {
  readonly saves: RecordingSessionState[] = [];

  constructor(public stored: unknown | undefined) {}

  load(): Promise<unknown | undefined> {
    return Promise.resolve(this.stored);
  }

  save(state: RecordingSessionState): Promise<void> {
    this.stored = structuredClone(state);
    this.saves.push(structuredClone(state));
    return Promise.resolve();
  }
}

class FakeTimelineStore implements RecordingTimelineStore {
  readonly saves: RecordingTimeline[] = [];
  failLoad = false;
  failSave = false;

  constructor(public stored: unknown | undefined) {}

  load(): Promise<unknown | undefined> {
    return this.failLoad
      ? Promise.reject(new Error('unavailable'))
      : Promise.resolve(this.stored);
  }

  save(timeline: RecordingTimeline): Promise<void> {
    if (this.failSave) {
      return Promise.reject(new Error('unavailable'));
    }
    this.stored = structuredClone(timeline);
    this.saves.push(structuredClone(timeline));
    return Promise.resolve();
  }
}

function createRecordingState(): RecordingSessionState {
  const idle = createInitialRecordingState(timestamp);
  const starting = transitionRecordingState(
    idle,
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

function createCandidateMessage() {
  return {
    type: 'recorder/event-candidate',
    candidate: {
      schemaVersion: 2,
      eventType: 'click',
      occurredAt: timestamp,
      target: {
        tagName: 'button',
        inputType: null,
        role: null,
        id: null,
        name: null,
        labelText: null,
        accessibleName: 'Save',
        placeholder: null,
        textPreview: 'Save',
        testIdCandidates: [],
      },
      locatorBundle: locatorBundleFixture,
      payload: { activation: 'primary' },
    },
  };
}

const sender: RecordingEventSenderContext = {
  tabId: 42,
  frameId: 0,
  origin: 'https://example.com',
};

function createController(options?: {
  state?: RecordingSessionState;
  timeline?: RecordingTimeline;
}) {
  const stateStore = new FakeStateStore(
    options?.state ?? createRecordingState(),
  );
  const timelineStore = new FakeTimelineStore(
    options?.timeline ?? createRecordingTimeline(sessionId),
  );
  const clock = { now: () => timestamp } satisfies RecorderClock;
  const ids = { createEventId: () => eventId } satisfies EventIdGenerator;

  return {
    stateStore,
    timelineStore,
    controller: new RecordingEventController(
      stateStore,
      timelineStore,
      clock,
      ids,
    ),
  };
}

describe('RecordingEventController', () => {
  it('accepts a candidate for the active session, tab, frame and origin', async () => {
    const { controller, timelineStore } = createController();

    const result = await controller.handle(createCandidateMessage(), sender);

    expect(result).toMatchObject({
      response: {
        success: true,
        sequence: 1,
        summary: { eventCount: 1, latestEventType: 'click' },
      },
      stateChanged: false,
    });
    expect(timelineStore.saves[0]?.events[0]).toMatchObject({
      eventId,
      sessionId,
      tabId: 42,
      sequence: 1,
      origin: 'https://example.com',
    });
  });

  it.each(['idle', 'paused'] as const)(
    'rejects candidates while %s',
    async (status) => {
      const recording = createRecordingState();
      const state =
        status === 'idle'
          ? createInitialRecordingState(timestamp)
          : (() => {
              const paused = transitionRecordingState(
                recording,
                { type: 'pause' },
                timestamp,
              );
              if (!paused.success) {
                throw new Error('Expected paused state');
              }
              return paused.state;
            })();
      const { controller, timelineStore } = createController({ state });

      const result = await controller.handle(createCandidateMessage(), sender);

      expect(result.response).toMatchObject({
        success: false,
        error: { code: 'EVENT_REJECTED' },
      });
      expect(timelineStore.saves).toHaveLength(0);
    },
  );

  it.each([
    {
      invalidSender: { ...sender, tabId: 99 },
      label: 'another tab',
    },
    {
      invalidSender: { ...sender, origin: 'https://other.example' },
      label: 'another origin',
    },
    {
      invalidSender: { ...sender, frameId: 1 },
      label: 'a child frame',
    },
  ] as const)('rejects candidates from $label', async ({ invalidSender }) => {
    const { controller, timelineStore } = createController();

    const result = await controller.handle(
      createCandidateMessage(),
      invalidSender,
    );

    expect(result.response).toMatchObject({
      success: false,
      error: { code: 'EVENT_REJECTED' },
    });
    expect(timelineStore.saves).toHaveLength(0);
  });

  it('assigns monotonically increasing sequences', async () => {
    const { controller, timelineStore } = createController();

    const first = await controller.handle(createCandidateMessage(), sender);
    const second = await controller.handle(createCandidateMessage(), sender);

    expect(first.response).toMatchObject({ success: true, sequence: 1 });
    expect(second.response).toMatchObject({ success: true, sequence: 2 });
    expect(
      (timelineStore.stored as RecordingTimeline).events.map(
        (event) => event.sequence,
      ),
    ).toEqual([1, 2]);
  });

  it('moves the recorder to a safe error when timeline storage fails', async () => {
    const { controller, timelineStore, stateStore } = createController();
    timelineStore.failSave = true;

    const result = await controller.handle(createCandidateMessage(), sender);

    expect(result).toMatchObject({
      response: {
        success: false,
        error: { code: 'STORAGE_FAILURE' },
      },
      stateChanged: true,
    });
    expect((stateStore.stored as RecordingSessionState).status).toBe('error');
  });

  it('enforces the event limit without discarding the stored timeline', async () => {
    const baseEvent = {
      ...createCandidateMessage().candidate,
      eventId,
      sessionId,
      tabId: 42,
      origin: 'https://example.com',
      recordedAt: timestamp,
    };
    const events = Array.from(
      { length: MAX_RECORDING_EVENTS },
      (_, index) =>
        ({
          ...baseEvent,
          sequence: index + 1,
        }) as RecordingEvent,
    );
    const fullTimeline: RecordingTimeline = {
      schemaVersion: 2,
      sessionId,
      nextSequence: MAX_RECORDING_EVENTS + 1,
      events,
    };
    const { controller, timelineStore, stateStore } = createController({
      timeline: fullTimeline,
    });

    const result = await controller.handle(createCandidateMessage(), sender);

    expect(result).toMatchObject({
      response: {
        success: false,
        error: { code: 'EVENT_LIMIT_REACHED' },
      },
      stateChanged: true,
    });
    expect(timelineStore.saves).toHaveLength(0);
    expect((timelineStore.stored as RecordingTimeline).events).toHaveLength(
      MAX_RECORDING_EVENTS,
    );
    expect((stateStore.stored as RecordingSessionState).status).toBe('error');
  });
});
