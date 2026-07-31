import type { Locator, Page } from 'playwright';
import { errors } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import { executeStep, type StepExecutionContext } from './step-executor.js';

function setup() {
  const locatorMock = {
    first: vi.fn(),
    waitFor: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    setChecked: vi.fn().mockResolvedValue(undefined),
  };
  const locator = locatorMock as unknown as Locator;
  locatorMock.first.mockReturnValue(locator);
  const page = {
    getByTestId: vi.fn().mockReturnValue(locator),
    getByLabel: vi.fn().mockReturnValue(locator),
  } as unknown as Page;
  const context: StepExecutionContext = {
    page,
    runtimeValues: {
      customerName: { kind: 'string', value: 'runtime text' },
    },
    allowedOrigins: ['http://127.0.0.1:4177'],
    options: {
      headless: true,
      actionTimeoutMs: 1_000,
      navigationTimeoutMs: 1_000,
    },
    effectiveTimeoutMs: 1_000,
  };
  return { locatorMock, context };
}

describe('supported step executors', () => {
  it('fills literal and variable values only at the Playwright boundary', async () => {
    const fixture = setup();
    await executeStep(
      {
        id: 'literal',
        type: 'fill',
        name: 'Literal',
        locator: { kind: 'testId', value: 'name' },
        value: { kind: 'literal', value: 'literal text' },
      },
      fixture.context,
    );
    await executeStep(
      {
        id: 'variable',
        type: 'fill',
        name: 'Variable',
        locator: { kind: 'testId', value: 'name' },
        value: { kind: 'variable', variableName: 'customerName' },
      },
      fixture.context,
    );
    expect(fixture.locatorMock.fill).toHaveBeenNthCalledWith(
      1,
      'literal text',
      { timeout: 1_000 },
    );
    expect(fixture.locatorMock.fill).toHaveBeenNthCalledWith(
      2,
      'runtime text',
      { timeout: 1_000 },
    );
  });

  it('sets checked and unchecked state without blind clicks', async () => {
    const fixture = setup();
    for (const checked of [true, false]) {
      await executeStep(
        {
          id: `checked-${String(checked)}`,
          type: 'setChecked',
          name: 'Set state',
          locator: { kind: 'label', value: 'Confirm fixture' },
          checked,
        },
        fixture.context,
      );
    }
    expect(fixture.locatorMock.setChecked).toHaveBeenNthCalledWith(1, true, {
      timeout: 1_000,
    });
    expect(fixture.locatorMock.setChecked).toHaveBeenNthCalledWith(2, false, {
      timeout: 1_000,
    });
    expect(fixture.locatorMock.click).not.toHaveBeenCalled();
  });

  it('maps Playwright action timeouts to a safe code', async () => {
    const fixture = setup();
    fixture.locatorMock.click.mockRejectedValueOnce(
      new errors.TimeoutError('raw locator and URL must not escape'),
    );
    await expect(
      executeStep(
        {
          id: 'timeout',
          type: 'click',
          name: 'Timeout',
          locator: { kind: 'testId', value: 'action' },
        },
        fixture.context,
      ),
    ).rejects.toMatchObject({
      safe: {
        code: 'ACTION_TIMEOUT',
        message: 'The browser action exceeded its allowed step timeout.',
      },
    });
  });

  it('performs only the explicit bounded wait', async () => {
    vi.useFakeTimers();
    try {
      const fixture = setup();
      const waiting = executeStep(
        {
          id: 'wait',
          type: 'wait',
          name: 'Wait',
          durationMs: 250,
        },
        fixture.context,
      );
      await vi.advanceTimersByTimeAsync(249);
      let complete = false;
      void waiting.then(() => {
        complete = true;
      });
      await Promise.resolve();
      expect(complete).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(waiting).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
