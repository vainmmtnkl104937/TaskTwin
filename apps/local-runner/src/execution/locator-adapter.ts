import {
  MAX_CSS_SELECTOR_LENGTH,
  MAX_LOCATOR_VALUE_LENGTH,
  MAX_TEST_ID_LENGTH,
  MAX_VISIBLE_TEXT_LENGTH,
} from '@tasktwin/locator-engine';
import type { ElementLocator } from '@tasktwin/workflow-schema';
import type { Locator, Page } from 'playwright';

import { SafeExecutionException, mapActionError } from './errors.js';

const SUPPORTED_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'option',
  'radio',
  'tab',
  'textbox',
]);

type PlaywrightRole = Parameters<Page['getByRole']>[0];

function escapeCssString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '\\d ')
    .replaceAll('\n', '\\a ');
}

function locatorValueLength(locator: ElementLocator): number {
  switch (locator.kind) {
    case 'testId':
    case 'label':
    case 'placeholder':
    case 'text':
      return locator.value.length;
    case 'role':
      return Math.max(locator.role.length, locator.name?.length ?? 0);
    case 'css':
      return locator.selector.length;
  }
}

export function validateExecutableLocator(locator: ElementLocator): void {
  const maximum =
    locator.kind === 'css'
      ? MAX_CSS_SELECTOR_LENGTH
      : locator.kind === 'testId'
        ? MAX_TEST_ID_LENGTH
        : locator.kind === 'text'
          ? MAX_VISIBLE_TEXT_LENGTH
          : MAX_LOCATOR_VALUE_LENGTH;
  if (locatorValueLength(locator) > maximum) {
    throw new SafeExecutionException('UNSUPPORTED_LOCATOR');
  }
  if (
    locator.kind === 'css' &&
    (/^\s*(?:\/|xpath\s*=)/i.test(locator.selector) ||
      locator.selector.trimStart().startsWith('..'))
  ) {
    throw new SafeExecutionException('UNSUPPORTED_LOCATOR');
  }
  if (locator.kind === 'role' && !SUPPORTED_ROLES.has(locator.role)) {
    throw new SafeExecutionException('UNSUPPORTED_ROLE');
  }
}

export class PlaywrightLocatorAdapter {
  constructor(
    private readonly page: Page,
    private readonly actionTimeoutMs: number,
  ) {}

  async resolveUnique(
    locator: ElementLocator,
    signal?: AbortSignal,
  ): Promise<Locator> {
    validateExecutableLocator(locator);
    const playwrightLocator = this.create(locator);
    try {
      await playwrightLocator.first().waitFor({
        state: 'attached',
        timeout: this.actionTimeoutMs,
      });
      const count = await playwrightLocator.count();
      if (count === 0) {
        throw new SafeExecutionException('LOCATOR_NOT_FOUND');
      }
      if (count !== 1) {
        throw new SafeExecutionException('LOCATOR_NOT_UNIQUE');
      }
      return playwrightLocator;
    } catch (error: unknown) {
      if (error instanceof SafeExecutionException) {
        throw error;
      }
      const mapped = mapActionError(error, 'action', signal);
      if (mapped.safe.code === 'ACTION_TIMEOUT') {
        throw new SafeExecutionException('LOCATOR_NOT_FOUND');
      }
      throw mapped;
    }
  }

  create(locator: ElementLocator): Locator {
    validateExecutableLocator(locator);
    switch (locator.kind) {
      case 'testId': {
        const attribute = locator.attribute ?? 'data-testid';
        if (attribute === 'data-testid') {
          return this.page.getByTestId(locator.value);
        }
        return this.page.locator(
          `css=[${attribute}="${escapeCssString(locator.value)}"]`,
        );
      }
      case 'role':
        return this.page.getByRole(locator.role as PlaywrightRole, {
          ...(locator.name === undefined ? {} : { name: locator.name }),
          exact: locator.exact ?? true,
        });
      case 'label':
        return this.page.getByLabel(locator.value, {
          exact: locator.exact ?? true,
        });
      case 'placeholder':
        return this.page.getByPlaceholder(locator.value, {
          exact: locator.exact ?? true,
        });
      case 'text':
        return this.page.getByText(locator.value, {
          exact: locator.exact ?? true,
        });
      case 'css':
        return this.page.locator(`css=${locator.selector}`);
    }
  }
}
