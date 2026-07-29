// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EventCaptureController,
  INPUT_DEBOUNCE_MS,
  type RecordingCandidateEmitter,
  type TrustedEventPolicy,
} from '../src/content/event-capture.js';
import { ContentScriptController } from '../src/content-script-controller.js';
import {
  createInitialRecordingState,
  transitionRecordingState,
} from '../src/recorder/state-machine.js';
import type { RecordingEventCandidate } from '../src/recorder/event-contracts.js';

const timestamp = '2026-07-29T10:00:00.000Z';
const sessionId = '57a1a7d4-5ada-4bc8-ac17-10c84746a567';
const captures: EventCaptureController[] = [];

const trustedPolicy: TrustedEventPolicy = {
  isTrusted: () => true,
};

function createCapture(policy = trustedPolicy) {
  const candidates: RecordingEventCandidate[] = [];
  const emitter = {
    emit: vi.fn((candidate: RecordingEventCandidate) => {
      candidates.push(structuredClone(candidate));
      return Promise.resolve(true);
    }),
  } satisfies RecordingCandidateEmitter;
  const capture = new EventCaptureController(
    document,
    emitter,
    { now: () => timestamp },
    policy,
  );
  captures.push(capture);
  return { candidates, capture, emitter };
}

function dispatchInput(input: HTMLInputElement): void {
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function createRecordingNotification() {
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
  return {
    type: 'recorder/state-changed' as const,
    state: recording.state,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.useFakeTimers();
});

afterEach(() => {
  for (const capture of captures.splice(0)) {
    capture.stopWithoutFlush();
  }
  vi.useRealTimers();
});

describe('document-level recording event capture', () => {
  it('normalizes a nested primary click to one actionable button', () => {
    document.body.innerHTML = `
      <button id="save" data-testid="save-action">
        <span id="icon">Save icon</span>
      </button>
    `;
    const { candidates, capture } = createCapture();
    capture.start();

    document.querySelector('#icon')?.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        button: 0,
        composed: true,
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      eventType: 'click',
      target: {
        tagName: 'button',
        id: 'save',
        testIdCandidates: [{ attribute: 'data-testid', value: 'save-action' }],
      },
    });
  });

  it('ignores right-click, middle-click and untrusted policy decisions', () => {
    document.body.innerHTML = '<button id="action">Action</button>';
    const button = document.querySelector('#action');
    const trusted = createCapture();
    trusted.capture.start();

    button?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 1 }),
    );
    button?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 2 }),
    );
    expect(trusted.candidates).toHaveLength(0);
    trusted.capture.stopWithoutFlush();

    const untrusted = createCapture({ isTrusted: () => false });
    untrusted.capture.start();
    button?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 0 }),
    );
    expect(untrusted.candidates).toHaveLength(0);
  });

  it('does not create duplicate click events for change-only controls', () => {
    document.body.innerHTML = `
      <label><input id="check" type="checkbox" /> Enable</label>
      <select id="select"><option value="one">One</option></select>
    `;
    const checkbox = document.querySelector<HTMLInputElement>('#check');
    const select = document.querySelector<HTMLSelectElement>('#select');
    const { candidates, capture } = createCapture();
    capture.start();

    checkbox?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 0 }),
    );
    select?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 0 }),
    );
    expect(candidates.filter((event) => event.eventType === 'click')).toEqual(
      [],
    );

    expect(candidates.map((event) => event.eventType)).toEqual(['checkbox']);
  });

  it('debounces multiple input events and emits the final value', async () => {
    document.body.innerHTML = '<input id="text" type="text" />';
    const input = document.querySelector<HTMLInputElement>('#text');
    const { candidates, capture } = createCapture();
    capture.start();

    if (input === null) {
      throw new Error('Expected text input');
    }
    for (const value of ['T', 'Ta', 'TaskTwin']) {
      input.value = value;
      dispatchInput(input);
    }

    await vi.advanceTimersByTimeAsync(INPUT_DEBOUNCE_MS - 1);
    expect(candidates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      eventType: 'text-input',
      payload: { masked: false, value: 'TaskTwin' },
    });
  });

  it('flushes a pending input on blur', () => {
    document.body.innerHTML = '<input id="text" type="text" />';
    const input = document.querySelector<HTMLInputElement>('#text');
    const { candidates, capture } = createCapture();
    capture.start();

    if (input === null) {
      throw new Error('Expected text input');
    }
    input.value = 'final value';
    dispatchInput(input);
    input.dispatchEvent(new FocusEvent('blur'));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      payload: { value: 'final value' },
    });
  });

  it.each(['pause', 'stop'] as const)(
    'flushes pending input before %s',
    async (reason) => {
      document.body.innerHTML = '<input id="text" type="text" />';
      const input = document.querySelector<HTMLInputElement>('#text');
      const { candidates, capture } = createCapture();
      const contentController = new ContentScriptController(capture);
      await contentController.handle(createRecordingNotification());

      if (input === null) {
        throw new Error('Expected text input');
      }
      input.value = `value before ${reason}`;
      dispatchInput(input);

      const response = await contentController.handle({
        type: 'recorder/flush-pending',
        sessionId,
        reason,
      });

      expect(response).toEqual({ success: true, flushed: true });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        payload: { value: `value before ${reason}` },
      });
      expect(capture.isCapturing()).toBe(false);
    },
  );

  it('never emits password or one-time-code plaintext', async () => {
    document.body.innerHTML = `
      <input id="password" type="password" autocomplete="current-password" />
      <input id="otp" type="text" autocomplete="one-time-code" />
    `;
    const password = document.querySelector<HTMLInputElement>('#password');
    const otp = document.querySelector<HTMLInputElement>('#otp');
    const { candidates, capture } = createCapture();
    capture.start();

    if (password === null || otp === null) {
      throw new Error('Expected secret inputs');
    }
    password.value = 'password-plaintext';
    otp.value = '123456';
    dispatchInput(password);
    dispatchInput(otp);
    await vi.advanceTimersByTimeAsync(INPUT_DEBOUNCE_MS);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((event) => event.payload)).toEqual([
      {
        masked: true,
        maskedReason: 'password',
        value: null,
        truncated: false,
      },
      {
        masked: true,
        maskedReason: 'one-time-code',
        value: null,
        truncated: false,
      },
    ]);
    expect(JSON.stringify(candidates)).not.toContain('password-plaintext');
    expect(JSON.stringify(candidates)).not.toContain('123456');
  });

  it('ignores hidden and file inputs', async () => {
    document.body.innerHTML = `
      <input id="hidden" type="hidden" />
      <input id="file" type="file" />
    `;
    const { candidates, capture } = createCapture();
    capture.start();

    for (const input of document.querySelectorAll<HTMLInputElement>('input')) {
      dispatchInput(input);
    }
    await vi.advanceTimersByTimeAsync(INPUT_DEBOUNCE_MS);

    expect(candidates).toHaveLength(0);
  });

  it('captures select, checkbox and only newly selected radio options', () => {
    document.body.innerHTML = `
      <select id="select">
        <option value="first">First option</option>
        <option value="second">Second option</option>
      </select>
      <input id="check" type="checkbox" />
      <input id="alpha" type="radio" name="choice" value="alpha" />
      <input id="beta" type="radio" name="choice" value="beta" />
    `;
    const select = document.querySelector<HTMLSelectElement>('#select');
    const checkbox = document.querySelector<HTMLInputElement>('#check');
    const alpha = document.querySelector<HTMLInputElement>('#alpha');
    const beta = document.querySelector<HTMLInputElement>('#beta');
    const { candidates, capture } = createCapture();
    capture.start();

    if (
      select === null ||
      checkbox === null ||
      alpha === null ||
      beta === null
    ) {
      throw new Error('Expected fixture controls');
    }

    select.value = 'second';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    alpha.checked = true;
    alpha.dispatchEvent(new Event('change', { bubbles: true }));
    alpha.checked = false;
    alpha.dispatchEvent(new Event('change', { bubbles: true }));
    beta.checked = true;
    beta.dispatchEvent(new Event('change', { bubbles: true }));

    expect(candidates.map((event) => event.eventType)).toEqual([
      'select',
      'checkbox',
      'checkbox',
      'radio',
      'radio',
    ]);
    expect(candidates[0]?.payload).toEqual({
      value: 'second',
      label: 'Second option',
      truncated: false,
    });
    expect(candidates.slice(1, 3).map((event) => event.payload)).toEqual([
      { checked: true },
      { checked: false },
    ]);
    expect(candidates.slice(3).map((event) => event.payload)).toEqual([
      { checked: true, value: 'alpha', truncated: false },
      { checked: true, value: 'beta', truncated: false },
    ]);
  });

  it('does not prevent or stop page events', () => {
    document.body.innerHTML = '<button id="action">Action</button>';
    const button = document.querySelector('#action');
    const { capture } = createCapture();
    capture.start();
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });

    button?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(event.cancelBubble).toBe(false);
  });
});
