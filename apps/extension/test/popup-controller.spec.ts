import { describe, expect, it, vi } from 'vitest';

import {
  createPopupPresentation,
  getValidPopupActions,
  PopupController,
  type PopupAction,
  type PopupPresentation,
  type PopupMessenger,
  type PopupView,
} from '../src/popup-controller.js';
import type { RecordingSessionState } from '../src/recorder/contracts.js';
import {
  createInitialRecordingState,
  transitionRecordingState,
} from '../src/recorder/state-machine.js';

const timestamp = '2026-07-29T10:00:00.000Z';
const emptyTimelineSummary = {
  eventCount: 0,
  latestEventType: null,
} as const;

function createMessenger(send: PopupMessenger['send']): PopupMessenger {
  return {
    send,
    subscribe: vi.fn(),
  };
}

function createSubscribableMessenger(send: PopupMessenger['send']): {
  messenger: PopupMessenger;
  notify(message: unknown): void;
} {
  let listener: ((message: unknown) => void) | undefined;
  return {
    messenger: {
      send,
      subscribe(handler) {
        listener = handler;
      },
    },
    notify(message) {
      listener?.(message);
    },
  };
}

class FakePopupView implements PopupView {
  readonly handlers = new Map<PopupAction, () => void | Promise<void>>();
  readonly presentations: PopupPresentation[] = [];

  bindAction(action: PopupAction, handler: () => void | Promise<void>): void {
    this.handlers.set(action, handler);
  }

  render(presentation: PopupPresentation): void {
    this.presentations.push(presentation);
  }
}

function createRecordingState(): RecordingSessionState {
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
  return recording.state;
}

describe('popup state and controller', () => {
  it('enables only valid controls for each recorder state', () => {
    expect(getValidPopupActions('idle')).toEqual(['start']);
    expect(getValidPopupActions('starting')).toEqual([]);
    expect(getValidPopupActions('recording')).toEqual(['pause', 'stop']);
    expect(getValidPopupActions('paused')).toEqual(['resume', 'stop']);
    expect(getValidPopupActions('stopping')).toEqual([]);
    expect(getValidPopupActions('error')).toEqual(['reset']);
  });

  it('restores an existing recording state when the popup reopens', async () => {
    const recording = createRecordingState();
    const send = vi.fn().mockResolvedValue({
      success: true,
      state: recording,
      timelineSummary: emptyTimelineSummary,
    });
    const view = new FakePopupView();
    const controller = new PopupController(createMessenger(send), view);

    await controller.initialize();

    expect(send).toHaveBeenCalledWith({ type: 'recorder/get-state' });
    expect(view.presentations.at(-1)).toEqual(
      createPopupPresentation(recording, emptyTimelineSummary),
    );
  });

  it('restores an existing paused state when the popup reopens', async () => {
    const recording = createRecordingState();
    const paused = transitionRecordingState(
      recording,
      { type: 'pause' },
      timestamp,
    );
    if (!paused.success) {
      throw new Error('Expected paused state');
    }
    const send = vi.fn().mockResolvedValue({
      success: true,
      state: paused.state,
      timelineSummary: emptyTimelineSummary,
    });
    const view = new FakePopupView();
    const controller = new PopupController(createMessenger(send), view);

    await controller.initialize();

    expect(view.presentations.at(-1)).toEqual(
      createPopupPresentation(paused.state, emptyTimelineSummary),
    );
    expect(view.presentations.at(-1)?.enabledActions).toEqual([
      'resume',
      'stop',
    ]);
  });

  it('dispatches commands and renders pending transitional status', async () => {
    const idle = createInitialRecordingState(timestamp);
    const recording = createRecordingState();
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        state: idle,
        timelineSummary: emptyTimelineSummary,
      })
      .mockResolvedValueOnce({
        success: true,
        state: recording,
        timelineSummary: emptyTimelineSummary,
      });
    const view = new FakePopupView();
    const controller = new PopupController(createMessenger(send), view);
    await controller.initialize();

    await controller.dispatch('start');

    expect(send).toHaveBeenLastCalledWith({ type: 'recorder/start' });
    expect(view.presentations.at(-2)).toMatchObject({
      status: 'starting',
      enabledActions: [],
      pending: true,
    });
    expect(view.presentations.at(-1)).toMatchObject({
      status: 'recording',
      enabledActions: ['pause', 'stop'],
      pending: false,
    });
  });

  it('renders fixed safe error text instead of an inbound message', async () => {
    const idle = createInitialRecordingState(timestamp);
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        state: idle,
        timelineSummary: emptyTimelineSummary,
      })
      .mockResolvedValueOnce({
        success: false,
        error: {
          code: 'UNSUPPORTED_PAGE',
          message: '<img src=x onerror=alert(1)>',
        },
        state: {
          ...idle,
          status: 'error',
          error: {
            code: 'UNSUPPORTED_PAGE',
            message: '<img src=x onerror=alert(1)>',
          },
        },
        timelineSummary: emptyTimelineSummary,
      });
    const view = new FakePopupView();
    const controller = new PopupController(createMessenger(send), view);
    await controller.initialize();

    await controller.dispatch('start');

    expect(view.presentations.at(-1)?.errorMessage).toBe(
      'TaskTwin cannot record this type of browser page.',
    );
    expect(view.presentations.at(-1)?.errorMessage).not.toContain('<img');
  });

  it('renders only the event count and fixed safe action summary', async () => {
    const recording = createRecordingState();
    const send = vi.fn().mockResolvedValue({
      success: true,
      state: recording,
      timelineSummary: emptyTimelineSummary,
    });
    const { messenger, notify } = createSubscribableMessenger(send);
    const view = new FakePopupView();
    const controller = new PopupController(messenger, view);
    await controller.initialize();

    notify({
      type: 'recorder/timeline-summary-changed',
      summary: {
        eventCount: 3,
        latestEventType: 'text-input',
      },
      rawValue: 'must-not-render',
    });
    expect(view.presentations.at(-1)?.eventCount).toBe(0);

    notify({
      type: 'recorder/timeline-summary-changed',
      summary: {
        eventCount: 3,
        latestEventType: 'text-input',
      },
    });
    expect(view.presentations.at(-1)).toMatchObject({
      eventCount: 3,
      latestEventSummary: 'Text input',
    });
    expect(JSON.stringify(view.presentations.at(-1))).not.toContain(
      'must-not-render',
    );
  });
});
