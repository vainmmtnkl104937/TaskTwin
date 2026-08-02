import type { Locator, Page } from 'playwright';
import { errors } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeValueResolver } from '@tasktwin/workflow-engine';

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
    innerText: vi.fn().mockResolvedValue('  customer-42\r\n'),
    inputValue: vi.fn().mockResolvedValue('selected-value'),
    isChecked: vi.fn().mockResolvedValue(true),
    getAttribute: vi.fn().mockResolvedValue('text'),
  };
  const locator = locatorMock as unknown as Locator;
  locatorMock.first.mockReturnValue(locator);
  const page = {
    getByTestId: vi.fn().mockReturnValue(locator),
    getByLabel: vi.fn().mockReturnValue(locator),
  } as unknown as Page;
  const context: StepExecutionContext = {
    page,
    valueResolver: createRuntimeValueResolver({
      customerName: { kind: 'string', value: 'runtime text' },
    }),
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
  it('extracts text, field values and checked state without exposing them in safe metadata', async () => {
    const fixture = setup();
    const base = {
      type: 'extract' as const,
      name: 'Extract',
      locator: { kind: 'testId' as const, value: 'source' },
      retention: 'ephemeral' as const,
    };
    await expect(
      executeStep(
        {
          ...base,
          id: 'text',
          source: { kind: 'text' },
          outputName: 'textOutput',
        },
        fixture.context,
      ),
    ).resolves.toMatchObject({
      producedOutput: {
        outputName: 'textOutput',
        outputType: 'string',
        value: 'customer-42',
      },
    });
    await expect(
      executeStep(
        {
          ...base,
          id: 'value',
          source: { kind: 'value' },
          outputName: 'valueOutput',
        },
        fixture.context,
      ),
    ).resolves.toMatchObject({
      producedOutput: {
        outputName: 'valueOutput',
        outputType: 'string',
        value: 'selected-value',
      },
    });
    await expect(
      executeStep(
        {
          ...base,
          id: 'checked',
          source: { kind: 'checked' },
          outputName: 'checkedOutput',
        },
        fixture.context,
      ),
    ).resolves.toMatchObject({
      producedOutput: {
        outputName: 'checkedOutput',
        outputType: 'boolean',
        value: true,
      },
    });
    expect(fixture.locatorMock.click).not.toHaveBeenCalled();
  });

  it('extracts only safe URL origin or origin and path', async () => {
    const fixture = setup();
    (fixture.context.page.url as ReturnType<typeof vi.fn>) = vi.fn(
      () => 'http://127.0.0.1:4177/customer?id=secret#fragment',
    );
    const result = await executeStep(
      {
        id: 'url',
        type: 'extract',
        name: 'Extract URL',
        source: { kind: 'url', mode: 'origin_and_path' },
        outputName: 'location',
        retention: 'ephemeral',
      },
      fixture.context,
    );
    expect(result).toMatchObject({
      producedOutput: { value: 'http://127.0.0.1:4177/customer' },
    });
    expect(JSON.stringify(result)).not.toContain('secret');

    (fixture.context.page.url as ReturnType<typeof vi.fn>) = vi.fn(
      () => 'https://not-allowed.example/result',
    );
    await expect(
      executeStep(
        {
          id: 'disallowedUrl',
          type: 'extract',
          name: 'Extract disallowed URL',
          source: { kind: 'url', mode: 'origin' },
          outputName: 'disallowedLocation',
          retention: 'ephemeral',
        },
        fixture.context,
      ),
    ).rejects.toMatchObject({ safe: { code: 'ORIGIN_NOT_ALLOWED' } });
  });

  it('rejects password field extraction', async () => {
    const fixture = setup();
    fixture.locatorMock.getAttribute.mockResolvedValueOnce('password');
    await expect(
      executeStep(
        {
          id: 'password',
          type: 'extract',
          name: 'Extract password',
          locator: { kind: 'testId', value: 'password' },
          source: { kind: 'value' },
          outputName: 'forbidden',
          retention: 'ephemeral',
        },
        fixture.context,
      ),
    ).rejects.toMatchObject({
      safe: { code: 'EXTRACTION_TARGET_UNSUPPORTED' },
    });
  });

  it('requires one unique extraction target and honours cancellation', async () => {
    const missing = setup();
    missing.locatorMock.count.mockResolvedValue(0);
    missing.context.effectiveTimeoutMs = 1;
    await expect(
      executeStep(
        {
          id: 'missing',
          type: 'extract',
          name: 'Missing target',
          locator: { kind: 'testId', value: 'missing' },
          source: { kind: 'text' },
          outputName: 'missingOutput',
          timeoutMs: 100,
          retention: 'ephemeral',
        },
        missing.context,
      ),
    ).rejects.toMatchObject({ safe: { code: 'LOCATOR_NOT_FOUND' } });

    const duplicate = setup();
    duplicate.locatorMock.count.mockResolvedValue(2);
    await expect(
      executeStep(
        {
          id: 'duplicate',
          type: 'extract',
          name: 'Duplicate target',
          locator: { kind: 'testId', value: 'repeated' },
          source: { kind: 'text' },
          outputName: 'duplicateOutput',
          retention: 'ephemeral',
        },
        duplicate.context,
      ),
    ).rejects.toMatchObject({ safe: { code: 'LOCATOR_NOT_UNIQUE' } });

    const cancelled = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeStep(
        {
          id: 'cancelled',
          type: 'extract',
          name: 'Cancelled extraction',
          locator: { kind: 'testId', value: 'source' },
          source: { kind: 'text' },
          outputName: 'cancelledOutput',
          retention: 'ephemeral',
        },
        { ...cancelled.context, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ safe: { code: 'EXECUTION_CANCELLED' } });
  });

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
