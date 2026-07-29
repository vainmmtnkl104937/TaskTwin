import {
  createRecorderError,
  RecordingSessionStateSchema,
  type RecorderError,
  type RecordingSessionState,
} from './contracts.js';

export type RecorderTransitionEvent =
  | { type: 'start'; sessionId: string }
  | {
      type: 'complete-start';
      activeTabId: number;
      activeWindowId: number;
      targetOrigin: string;
    }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'complete-stop' }
  | { type: 'reset' }
  | { type: 'fail'; error: RecorderError };

export type RecorderTransitionResult =
  | { success: true; state: RecordingSessionState }
  | { success: false; error: RecorderError };

export function createInitialRecordingState(
  now: string,
): RecordingSessionState {
  return RecordingSessionStateSchema.parse({
    schemaVersion: 1,
    status: 'idle',
    sessionId: null,
    activeTabId: null,
    activeWindowId: null,
    targetOrigin: null,
    startedAt: null,
    pausedAt: null,
    lastUpdatedAt: now,
    error: null,
  });
}

function successfulTransition(
  state: RecordingSessionState,
): RecorderTransitionResult {
  return {
    success: true,
    state: RecordingSessionStateSchema.parse(state),
  };
}

function invalidTransition(): RecorderTransitionResult {
  return {
    success: false,
    error: createRecorderError('INVALID_TRANSITION'),
  };
}

export function transitionRecordingState(
  state: RecordingSessionState,
  event: RecorderTransitionEvent,
  now: string,
): RecorderTransitionResult {
  switch (event.type) {
    case 'start':
      if (state.status !== 'idle') {
        return invalidTransition();
      }
      return successfulTransition({
        ...createInitialRecordingState(now),
        status: 'starting',
        sessionId: event.sessionId,
      });

    case 'complete-start':
      if (state.status !== 'starting') {
        return invalidTransition();
      }
      return successfulTransition({
        ...state,
        status: 'recording',
        activeTabId: event.activeTabId,
        activeWindowId: event.activeWindowId,
        targetOrigin: event.targetOrigin,
        startedAt: now,
        pausedAt: null,
        lastUpdatedAt: now,
      });

    case 'pause':
      if (state.status !== 'recording') {
        return invalidTransition();
      }
      return successfulTransition({
        ...state,
        status: 'paused',
        pausedAt: now,
        lastUpdatedAt: now,
      });

    case 'resume':
      if (state.status !== 'paused') {
        return invalidTransition();
      }
      return successfulTransition({
        ...state,
        status: 'recording',
        pausedAt: null,
        lastUpdatedAt: now,
      });

    case 'stop':
      if (state.status !== 'recording' && state.status !== 'paused') {
        return invalidTransition();
      }
      return successfulTransition({
        ...state,
        status: 'stopping',
        lastUpdatedAt: now,
      });

    case 'complete-stop':
      if (state.status !== 'stopping') {
        return invalidTransition();
      }
      return successfulTransition(createInitialRecordingState(now));

    case 'reset':
      if (state.status !== 'error') {
        return invalidTransition();
      }
      return successfulTransition(createInitialRecordingState(now));

    case 'fail':
      if (state.status === 'idle' || state.status === 'error') {
        return invalidTransition();
      }
      return successfulTransition({
        ...state,
        status: 'error',
        lastUpdatedAt: now,
        error: event.error,
      });
  }
}
