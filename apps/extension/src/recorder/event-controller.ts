import {
  createRecorderError,
  type RecorderErrorCode,
  type RecordingSessionState,
  RecordingSessionStateSchema,
} from './contracts.js';
import {
  RecordingEventCandidateMessageSchema,
  type RecordingEventCandidateResponse,
  RecordingTimelineSchema,
} from './event-contracts.js';
import type {
  EventIdGenerator,
  RecorderClock,
  RecordingStateStore,
  RecordingTimelineStore,
} from './ports.js';
import { transitionRecordingState } from './state-machine.js';
import {
  appendRecordingEvent,
  summarizeRecordingTimeline,
} from './timeline.js';

export interface RecordingEventSenderContext {
  tabId: number;
  frameId: number;
  origin: string;
}

export interface RecordingEventHandlingResult {
  response: RecordingEventCandidateResponse;
  stateChanged: boolean;
}

function failure(
  code: RecorderErrorCode,
  stateChanged = false,
): RecordingEventHandlingResult {
  return {
    response: {
      success: false,
      error: createRecorderError(code),
    },
    stateChanged,
  };
}

export class RecordingEventController {
  constructor(
    private readonly stateStore: RecordingStateStore,
    private readonly timelineStore: RecordingTimelineStore,
    private readonly clock: RecorderClock,
    private readonly eventIdGenerator: EventIdGenerator,
  ) {}

  async handle(
    message: unknown,
    sender: RecordingEventSenderContext,
  ): Promise<RecordingEventHandlingResult> {
    const parsedMessage =
      RecordingEventCandidateMessageSchema.safeParse(message);
    if (!parsedMessage.success) {
      return failure('INVALID_EVENT');
    }

    let storedState: unknown;
    try {
      storedState = await this.stateStore.load();
    } catch {
      return failure('STORAGE_FAILURE');
    }

    const parsedState = RecordingSessionStateSchema.safeParse(storedState);
    if (
      !parsedState.success ||
      parsedState.data.status !== 'recording' ||
      parsedState.data.sessionId === null ||
      parsedState.data.activeTabId === null ||
      parsedState.data.targetOrigin === null
    ) {
      return failure('EVENT_REJECTED');
    }

    const state = parsedState.data;
    if (
      sender.frameId !== 0 ||
      sender.tabId !== state.activeTabId ||
      sender.origin !== state.targetOrigin
    ) {
      return failure('EVENT_REJECTED');
    }

    let storedTimeline: unknown;
    try {
      storedTimeline = await this.timelineStore.load();
    } catch {
      return this.failActiveRecording(state, 'STORAGE_FAILURE');
    }

    const parsedTimeline = RecordingTimelineSchema.safeParse(storedTimeline);
    if (
      !parsedTimeline.success ||
      parsedTimeline.data.sessionId !== state.sessionId
    ) {
      return this.failActiveRecording(state, 'STORAGE_FAILURE');
    }

    const timeline = parsedTimeline.data;
    const appended = appendRecordingEvent(
      timeline,
      parsedMessage.data.candidate,
      {
        eventId: this.eventIdGenerator.createEventId(),
        sessionId: state.sessionId,
        sequence: timeline.nextSequence,
        tabId: state.activeTabId,
        origin: state.targetOrigin,
        recordedAt: this.clock.now(),
      },
    );

    if (!appended.success) {
      return this.failActiveRecording(state, 'EVENT_LIMIT_REACHED');
    }

    try {
      await this.timelineStore.save(appended.timeline);
    } catch {
      return this.failActiveRecording(state, 'STORAGE_FAILURE');
    }

    return {
      response: {
        success: true,
        sequence: appended.event.sequence,
        summary: summarizeRecordingTimeline(appended.timeline),
      },
      stateChanged: false,
    };
  }

  private async failActiveRecording(
    state: RecordingSessionState,
    code: Extract<RecorderErrorCode, 'EVENT_LIMIT_REACHED' | 'STORAGE_FAILURE'>,
  ): Promise<RecordingEventHandlingResult> {
    const transition = transitionRecordingState(
      state,
      {
        type: 'fail',
        error: createRecorderError(code),
      },
      this.clock.now(),
    );

    if (!transition.success) {
      return failure(code);
    }

    try {
      await this.stateStore.save(transition.state);
    } catch {
      return failure('STORAGE_FAILURE');
    }

    return failure(code, true);
  }
}
