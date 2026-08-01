import type { WorkflowRuntimeValueResolver } from '@tasktwin/workflow-engine';
import type { VerifyStep } from '@tasktwin/workflow-schema';
import type { Locator, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import { executeVerification } from './verification-executor.js';

function locator(overrides: Partial<Locator> = {}): Locator {
  return {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    innerText: vi.fn(async () => 'Fixture completed'),
    inputValue: vi.fn(async () => 'runtime-private'),
    isChecked: vi.fn(async () => true),
    getAttribute: vi.fn(async () => 'text'),
    ...overrides,
  } as unknown as Locator;
}

function page(
  selected = locator(),
  currentUrl = 'https://example.com/result?q=1#ok',
): Page {
  return {
    url: vi.fn(() => currentUrl),
    getByTestId: vi.fn(() => selected),
    getByLabel: vi.fn(() => selected),
    getByRole: vi.fn(() => selected),
    getByPlaceholder: vi.fn(() => selected),
    getByText: vi.fn(() => selected),
    locator: vi.fn(() => selected),
  } as unknown as Page;
}

function resolver(
  value: string | number | boolean,
): WorkflowRuntimeValueResolver {
  return {
    hasVariable: () => true,
    hasSecret: () => false,
    resolve: () => value,
  };
}

function step(assertion: VerifyStep['assertion'], timeoutMs = 200): VerifyStep {
  return {
    id: 'verify',
    type: 'verify',
    name: 'Verify outcome',
    assertion,
    timeoutMs,
  };
}

async function execute(
  verifyStep: VerifyStep,
  selectedPage: Page,
  value: string | number | boolean = '',
  signal?: AbortSignal,
) {
  return executeVerification(verifyStep, {
    page: selectedPage,
    valueResolver: resolver(value),
    effectiveTimeoutMs: 500,
    actionTimeoutMs: 500,
    ...(signal === undefined ? {} : { signal }),
  });
}

describe('Playwright verification executor', () => {
  it('verifies URL origin and origin plus path without reporting the URL', async () => {
    for (const matchMode of ['origin', 'origin_and_path'] as const) {
      const result = await execute(
        step({
          kind: 'url',
          matchMode,
          expected: { kind: 'literal', value: 'https://example.com/result' },
        }),
        page(),
        'https://example.com/result?expected=private',
      );
      expect(result.outcome).toBe('matched');
      expect(JSON.stringify(result)).not.toContain('example.com');
    }
  });

  it('verifies exact and contained rendered text', async () => {
    for (const matchMode of ['exact', 'contains'] as const) {
      const expected =
        matchMode === 'exact' ? 'Fixture completed' : 'completed';
      const result = await execute(
        step({
          kind: 'text',
          locator: { kind: 'testId', value: 'result' },
          matchMode,
          expected: { kind: 'literal', value: expected },
        }),
        page(),
        expected,
      );
      expect(result.outcome).toBe('matched');
      expect(JSON.stringify(result)).not.toContain(expected);
    }
  });

  it('verifies visible, hidden and absent elements', async () => {
    const visible = await execute(
      step({ kind: 'visible', locator: { kind: 'testId', value: 'result' } }),
      page(),
    );
    expect(visible.observedState).toBe('visible');

    const hidden = await execute(
      step({ kind: 'hidden', locator: { kind: 'testId', value: 'result' } }),
      page(locator({ isVisible: vi.fn(async () => false) })),
    );
    expect(hidden.observedState).toBe('hidden');

    const absent = await execute(
      step({ kind: 'hidden', locator: { kind: 'testId', value: 'missing' } }),
      page(locator({ count: vi.fn(async () => 0) })),
    );
    expect(absent.observedState).toBe('absent');
  });

  it('rejects a duplicate locator', async () => {
    await expect(
      execute(
        step({ kind: 'visible', locator: { kind: 'testId', value: 'result' } }),
        page(locator({ count: vi.fn(async () => 2) })),
      ),
    ).rejects.toMatchObject({ safe: { code: 'LOCATOR_NOT_UNIQUE' } });
  });

  it('verifies a field from a runtime variable without reporting it', async () => {
    const privateValue = 'runtime-private';
    const result = await execute(
      step({
        kind: 'value',
        locator: { kind: 'label', value: 'Customer name' },
        expected: { kind: 'variable', variableName: 'customerName' },
      }),
      page(),
      privateValue,
    );
    expect(result.outcome).toBe('matched');
    expect(JSON.stringify(result)).not.toContain(privateValue);
  });

  it('never verifies a password field value', async () => {
    await expect(
      execute(
        step({
          kind: 'value',
          locator: { kind: 'label', value: 'Password' },
          expected: { kind: 'literal', value: 'not-reported' },
        }),
        page(locator({ getAttribute: vi.fn(async () => 'password') })),
        'not-reported',
      ),
    ).rejects.toMatchObject({
      safe: { code: 'VERIFICATION_TARGET_UNSUPPORTED' },
    });
  });

  it('verifies checked true and false without clicking', async () => {
    for (const checked of [true, false]) {
      const selected = locator({ isChecked: vi.fn(async () => checked) });
      const result = await execute(
        step({
          kind: 'checked',
          locator: { kind: 'label', value: 'Confirm' },
          expected: checked,
        }),
        page(selected),
      );
      expect(result.observedState).toBe(checked ? 'checked' : 'unchecked');
      expect((selected.click as unknown) ?? undefined).toBeUndefined();
    }
  });

  it('stops bounded polling on cancellation', async () => {
    const controller = new AbortController();
    const cancellation = setTimeout(() => controller.abort(), 20);
    try {
      await expect(
        execute(
          step(
            { kind: 'visible', locator: { kind: 'testId', value: 'result' } },
            1_000,
          ),
          page(locator({ isVisible: vi.fn(async () => false) })),
          '',
          controller.signal,
        ),
      ).rejects.toMatchObject({ safe: { code: 'EXECUTION_CANCELLED' } });
    } finally {
      clearTimeout(cancellation);
    }
  });

  it('distinguishes a verification deadline from the engine step timeout', async () => {
    const neverVisible = page(locator({ isVisible: vi.fn(async () => false) }));
    await expect(
      execute(
        step(
          { kind: 'visible', locator: { kind: 'testId', value: 'result' } },
          100,
        ),
        neverVisible,
      ),
    ).rejects.toMatchObject({
      safe: { code: 'VERIFICATION_NOT_MATCHED' },
      verification: { outcome: 'not_matched' },
    });

    const noOwnTimeout: VerifyStep = {
      id: 'verify',
      type: 'verify',
      name: 'Verify',
      assertion: {
        kind: 'visible',
        locator: { kind: 'testId', value: 'result' },
      },
    };
    await expect(
      executeVerification(noOwnTimeout, {
        page: neverVisible,
        valueResolver: resolver(''),
        effectiveTimeoutMs: 100,
        actionTimeoutMs: 100,
      }),
    ).rejects.toMatchObject({ safe: { code: 'STEP_TIMEOUT' } });
  });
});
