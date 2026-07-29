import { describe, expect, it, vi } from 'vitest';

import {
  ContentScriptController,
  type EventCaptureLifecycle,
} from '../src/content-script-controller.js';
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
  function createController() {
    const capture = {
      start: vi.fn(),
      stopWithoutFlush: vi.fn(),
      suspendAndFlush: vi.fn().mockResolvedValue(true),
      isCapturing: vi.fn().mockReturnValue(true),
    } satisfies EventCaptureLifecycle;
    return { capture, controller: new ContentScriptController(capture) };
  }

  it('validates and acknowledges state notifications', async () => {
    const { controller, capture } = createController();

    await expect(
      controller.handle(createRecordingNotification()),
    ).resolves.toEqual({
      success: true,
      receivedStatus: 'recording',
    });
    expect(capture.start).toHaveBeenCalledOnce();
    expect(controller.isRecorderActive()).toBe(true);
    expect(controller.getStatus()).toBe('recording');
  });

  it('rejects malformed messages without changing its active state', async () => {
    const { controller } = createController();
    await controller.handle(createRecordingNotification());

    await expect(
      controller.handle({
        type: 'recorder/state-changed',
        state: { status: 'idle' },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'EVENT_REJECTED' },
    });
    expect(controller.isRecorderActive()).toBe(true);
    expect(controller.getStatus()).toBe('recording');
  });
});
