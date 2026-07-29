import { describe, expect, it } from 'vitest';

import { ContentScriptController } from '../src/content-script-controller.js';
import {
  createInitialRecordingState,
  transitionRecordingState,
} from '../src/recorder/state-machine.js';

const timestamp = '2026-07-29T10:00:00.000Z';

function createRecordingNotification() {
  const idle = createInitialRecordingState(timestamp);
  const starting = transitionRecordingState(
    idle,
    {
      type: 'start',
      sessionId: '57a1a7d4-5ada-4bc8-ac17-10c84746a567',
    },
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
  return {
    type: 'recorder/state-changed' as const,
    state: recording.state,
  };
}

describe('ContentScriptController', () => {
  it('validates and acknowledges state notifications', () => {
    const controller = new ContentScriptController();

    expect(controller.handle(createRecordingNotification())).toEqual({
      success: true,
      receivedStatus: 'recording',
    });
    expect(controller.isRecorderActive()).toBe(true);
    expect(controller.getStatus()).toBe('recording');
  });

  it('rejects malformed messages without changing its active state', () => {
    const controller = new ContentScriptController();
    controller.handle(createRecordingNotification());

    expect(
      controller.handle({
        type: 'recorder/state-changed',
        state: { status: 'idle' },
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'UNKNOWN_ERROR' },
    });
    expect(controller.isRecorderActive()).toBe(true);
    expect(controller.getStatus()).toBe('recording');
  });
});
