import { describe, expect, it, vi } from 'vitest';

import {
  ContentScriptController,
  type EventCaptureLifecycle,
  type PrivacyPreviewLifecycle,
  type PrivacySettingsStore,
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
      configurePrivacy: vi.fn(),
      start: vi.fn(),
      stopWithoutFlush: vi.fn(),
      suspendAndFlush: vi.fn().mockResolvedValue(true),
      isCapturing: vi.fn().mockReturnValue(true),
    } satisfies EventCaptureLifecycle;
    const settings = {
      load: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        personalDataPolicy: 'mask',
        redactAllTextInputs: false,
        showRedactionPreview: false,
      }),
    } satisfies PrivacySettingsStore;
    const preview = {
      activate: vi.fn(),
      clear: vi.fn(),
    } satisfies PrivacyPreviewLifecycle;
    return {
      capture,
      settings,
      preview,
      controller: new ContentScriptController(capture, settings, preview),
    };
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
    expect(capture.configurePrivacy).toHaveBeenCalledWith({
      schemaVersion: 1,
      personalDataPolicy: 'mask',
      redactAllTextInputs: false,
      showRedactionPreview: false,
    });
    expect(controller.isRecorderActive()).toBe(true);
    expect(controller.getStatus()).toBe('recording');
  });

  it('restores validated settings and limits preview activation to recording state', async () => {
    const { controller, preview, settings } = createController();
    await controller.handle(createRecordingNotification());

    expect(settings.load).toHaveBeenCalledOnce();
    expect(preview.activate).toHaveBeenCalledOnce();

    await controller.handle({
      type: 'recorder/state-changed',
      state: createInitialRecordingState(timestamp),
    });

    expect(preview.clear).toHaveBeenCalledOnce();
    expect(preview.activate).toHaveBeenCalledOnce();
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
