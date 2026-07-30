import type { ElementLocator, WorkflowStep } from '@tasktwin/workflow-schema';
import type { Page } from 'playwright';

import type { BrowserExecutionOptions } from './contracts.js';
import { SafeExecutionException, mapActionError } from './errors.js';
import { PlaywrightLocatorAdapter } from './locator-adapter.js';
import {
  assertFinalOriginAllowed,
  validateNavigationUrl,
} from './origin-policy.js';
import {
  resolveSelectValue,
  resolveTextValue,
  type RuntimeValueMap,
} from './value-source-resolver.js';

export type SupportedWorkflowStep = Extract<
  WorkflowStep,
  {
    type: 'navigate' | 'click' | 'fill' | 'select' | 'setChecked' | 'wait';
  }
>;

export interface StepExecutionContext {
  page: Page;
  runtimeValues: RuntimeValueMap;
  allowedOrigins: ReadonlySet<string>;
  options: BrowserExecutionOptions;
  signal?: AbortSignal;
}

export function stepLocatorKind(
  step: SupportedWorkflowStep,
): ElementLocator['kind'] | undefined {
  return 'locator' in step ? step.locator.kind : undefined;
}

async function cancellableWait(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    throw new SafeExecutionException('EXECUTION_CANCELLED');
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new SafeExecutionException('EXECUTION_CANCELLED'));
      },
      { once: true },
    );
  });
}

export async function executeStep(
  step: SupportedWorkflowStep,
  context: StepExecutionContext,
): Promise<void> {
  if (context.signal?.aborted === true) {
    throw new SafeExecutionException('EXECUTION_CANCELLED');
  }

  if (step.type === 'navigate') {
    const value = resolveTextValue(
      step.url,
      'navigate.url',
      context.runtimeValues,
    );
    const url = validateNavigationUrl(value, context.allowedOrigins);
    try {
      await context.page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: context.options.navigationTimeoutMs,
      });
      assertFinalOriginAllowed(context.page.url(), context.allowedOrigins);
      return;
    } catch (error: unknown) {
      throw mapActionError(error, 'navigation', context.signal);
    }
  }

  if (step.type === 'wait') {
    await cancellableWait(step.durationMs, context.signal);
    return;
  }

  const adapter = new PlaywrightLocatorAdapter(
    context.page,
    context.options.actionTimeoutMs,
  );
  const locator = await adapter.resolveUnique(step.locator, context.signal);
  try {
    switch (step.type) {
      case 'click':
        await locator.click({ timeout: context.options.actionTimeoutMs });
        return;
      case 'fill': {
        const value = resolveTextValue(
          step.value,
          'fill.value',
          context.runtimeValues,
        );
        await locator.fill(value, {
          timeout: context.options.actionTimeoutMs,
        });
        return;
      }
      case 'select': {
        const value = resolveSelectValue(step.value, context.runtimeValues);
        await locator.selectOption(
          { value },
          { timeout: context.options.actionTimeoutMs },
        );
        return;
      }
      case 'setChecked':
        await locator.setChecked(step.checked, {
          timeout: context.options.actionTimeoutMs,
        });
        return;
    }
  } catch (error: unknown) {
    throw mapActionError(error, 'action', context.signal);
  }
}
