import type { ElementLocator } from '@tasktwin/workflow-schema';
import type { Locator, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import { PlaywrightLocatorAdapter } from './locator-adapter.js';

function setup(count = 1) {
  const locatorMock = {
    first: vi.fn(),
    waitFor: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(count),
  };
  const locator = locatorMock as unknown as Locator;
  locatorMock.first.mockReturnValue(locator);
  const page = {
    getByTestId: vi.fn().mockReturnValue(locator),
    getByRole: vi.fn().mockReturnValue(locator),
    getByLabel: vi.fn().mockReturnValue(locator),
    getByPlaceholder: vi.fn().mockReturnValue(locator),
    getByText: vi.fn().mockReturnValue(locator),
    locator: vi.fn().mockReturnValue(locator),
    evaluate: vi.fn(),
  } as unknown as Page;
  return { locator, page, adapter: new PlaywrightLocatorAdapter(page, 1_000) };
}

describe('PlaywrightLocatorAdapter', () => {
  it.each([
    [{ kind: 'testId', value: 'save' }, 'getByTestId'],
    [{ kind: 'role', role: 'button', name: 'Save', exact: true }, 'getByRole'],
    [{ kind: 'label', value: 'Name', exact: true }, 'getByLabel'],
    [{ kind: 'placeholder', value: 'Search', exact: true }, 'getByPlaceholder'],
    [{ kind: 'text', value: 'Save', exact: true }, 'getByText'],
    [{ kind: 'css', selector: '#save' }, 'locator'],
  ] as const)('maps %o through %s', async (definition, method) => {
    const context = setup();
    await expect(
      context.adapter.resolveUnique(definition as ElementLocator),
    ).resolves.toBe(context.locator);
    expect(context.page[method]).toHaveBeenCalledOnce();
    expect(context.page.evaluate).not.toHaveBeenCalled();
  });

  it('supports allowlisted alternate test ID attributes safely', async () => {
    const context = setup();
    await context.adapter.resolveUnique({
      kind: 'testId',
      attribute: 'data-cy',
      value: 'save',
    });
    expect(context.page.locator).toHaveBeenCalledWith('css=[data-cy="save"]');
  });

  it('rejects unsupported roles and XPath-like CSS', async () => {
    const context = setup();
    await expect(
      context.adapter.resolveUnique({ kind: 'role', role: 'document' }),
    ).rejects.toMatchObject({ safe: { code: 'UNSUPPORTED_ROLE' } });
    await expect(
      context.adapter.resolveUnique({ kind: 'css', selector: '//button' }),
    ).rejects.toMatchObject({ safe: { code: 'UNSUPPORTED_LOCATOR' } });
  });

  it('returns typed errors for zero and duplicate matches', async () => {
    await expect(
      setup(0).adapter.resolveUnique({ kind: 'testId', value: 'missing' }),
    ).rejects.toMatchObject({ safe: { code: 'LOCATOR_NOT_FOUND' } });
    await expect(
      setup(2).adapter.resolveUnique({ kind: 'text', value: 'Duplicate' }),
    ).rejects.toMatchObject({ safe: { code: 'LOCATOR_NOT_UNIQUE' } });
  });
});
