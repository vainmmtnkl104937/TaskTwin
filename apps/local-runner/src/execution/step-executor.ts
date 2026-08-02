import {
  resolveSelectWithResolver,
  resolveTextWithResolver,
  type AdapterStepOutput,
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
import { executeVerification } from './verification-executor.js';
import { executeExtraction } from './extraction-executor.js';

export type SupportedWorkflowStep = Extract<
  WorkflowStep,
  {
    type:
      | 'navigate'
      | 'click'
      | 'fill'
      | 'select'
      | 'setChecked'
      | 'wait'
      | 'extract'
      | 'verify';
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
  if ('locator' in step && step.locator !== undefined) return step.locator.kind;
  return step.type === 'verify' && 'locator' in step.assertion
    ? step.assertion.locator.kind
    : undefined;
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
): Promise<AdapterStepOutput | void> {
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
      throw mapActionError(
        error,
        'navigation',
        context.signal,
        'side_effect_possible',
      );
    }
  }

  if (step.type === 'wait') {
    try {
      await cancellableWait(
        step.durationMs,
        context.effectiveTimeoutMs,
        context.signal,
      );
    } catch (error: unknown) {
      throw mapActionError(error, 'action', context.signal, 'read_only');
    }
    return;
  }

  if (step.type === 'verify') {
    try {
      return {
        verification: await executeVerification(step, {
          page: context.page,
          valueResolver: context.valueResolver,
          effectiveTimeoutMs: context.effectiveTimeoutMs,
          actionTimeoutMs: context.options.actionTimeoutMs,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        }),
      };
    } catch (error: unknown) {
      throw mapActionError(error, 'action', context.signal, 'read_only');
    }
  }

  if (step.type === 'extract') {
    try {
      return {
        producedOutput: await executeExtraction(step, {
          page: context.page,
          allowedOrigins: context.allowedOrigins,
          effectiveTimeoutMs: context.effectiveTimeoutMs,
          actionTimeoutMs: context.options.actionTimeoutMs,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        }),
      };
    } catch (error: unknown) {
      throw mapActionError(error, 'action', context.signal, 'read_only');
    }
  }

  const adapter = new PlaywrightLocatorAdapter(
    context.page,
    Math.min(context.options.actionTimeoutMs, context.effectiveTimeoutMs),
  );
  let locator;
  try {
    locator = await adapter.resolveUnique(step.locator, context.signal);
  } catch (error: unknown) {
    throw mapActionError(error, 'action', context.signal, 'not_started');
  }
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
    throw mapActionError(
      error,
      'action',
      context.signal,
      'side_effect_possible',
    );
  }
}
