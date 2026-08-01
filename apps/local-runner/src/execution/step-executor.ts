import {
  resolveSelectWithResolver,
  resolveTextWithResolver,
  type WorkflowRuntimeValueResolver,
} from '@tasktwin/workflow-engine';
import type { ElementLocator, WorkflowStep } from '@tasktwin/workflow-schema';
import type { Page } from 'playwright';

import type { BrowserExecutionOptions } from './contracts.js';
import { SafeExecutionException, mapActionError } from './errors.js';
import { PlaywrightLocatorAdapter } from './locator-adapter.js';
import {
  assertFinalOriginAllowed,
  validateNavigationUrl,
} from './origin-policy.js';

export type SupportedWorkflowStep = Extract<
  WorkflowStep,
  {
    type: 'navigate' | 'click' | 'fill' | 'select' | 'setChecked' | 'wait';
  }
>;

export interface StepExecutionContext {
  page: Page;
  valueResolver: WorkflowRuntimeValueResolver;
  allowedOrigins: readonly string[];
  options: BrowserExecutionOptions;
  effectiveTimeoutMs: number;
  signal?: AbortSignal;
}

export function stepLocatorKind(
  step: SupportedWorkflowStep,
): ElementLocator['kind'] | undefined {
  return 'locator' in step ? step.locator.kind : undefined;
}

async function cancellableWait(
  milliseconds: number,
  effectiveTimeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    throw new SafeExecutionException('EXECUTION_CANCELLED');
  }
  await new Promise<void>((resolve, reject) => {
    const waitWillTimeout = milliseconds > effectiveTimeoutMs;
    const delay = Math.min(milliseconds, effectiveTimeoutMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new SafeExecutionException('EXECUTION_CANCELLED'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      if (waitWillTimeout) {
        reject(new SafeExecutionException('STEP_TIMEOUT'));
      } else {
        resolve();
      }
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
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
    const value = resolveTextWithResolver(
      step.url,
      'navigate.url',
      context.valueResolver,
    );
    const url = validateNavigationUrl(value, context.allowedOrigins);
    try {
      await context.page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(
          context.options.navigationTimeoutMs,
          context.effectiveTimeoutMs,
        ),
      });
      assertFinalOriginAllowed(context.page.url(), context.allowedOrigins);
      return;
    } catch (error: unknown) {
      throw mapActionError(error, 'navigation', context.signal);
    }
  }

  if (step.type === 'wait') {
    await cancellableWait(
      step.durationMs,
      context.effectiveTimeoutMs,
      context.signal,
    );
    return;
  }

  const adapter = new PlaywrightLocatorAdapter(
    context.page,
    Math.min(context.options.actionTimeoutMs, context.effectiveTimeoutMs),
  );
  const locator = await adapter.resolveUnique(step.locator, context.signal);
  try {
    switch (step.type) {
      case 'click':
        await locator.click({
          timeout: Math.min(
            context.options.actionTimeoutMs,
            context.effectiveTimeoutMs,
          ),
        });
        return;
      case 'fill': {
        const value = resolveTextWithResolver(
          step.value,
          'fill.value',
          context.valueResolver,
        );
        await locator.fill(value, {
          timeout: Math.min(
            context.options.actionTimeoutMs,
            context.effectiveTimeoutMs,
          ),
        });
        return;
      }
      case 'select': {
        const value = resolveSelectWithResolver(
          step.value,
          context.valueResolver,
        );
        await locator.selectOption(
          { value },
          {
            timeout: Math.min(
              context.options.actionTimeoutMs,
              context.effectiveTimeoutMs,
            ),
          },
        );
        return;
      }
      case 'setChecked':
        await locator.setChecked(step.checked, {
          timeout: Math.min(
            context.options.actionTimeoutMs,
            context.effectiveTimeoutMs,
          ),
        });
        return;
    }
  } catch (error: unknown) {
    throw mapActionError(error, 'action', context.signal);
  }
}
