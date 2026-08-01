import type { WorkflowRuntimeValueResolver } from '@tasktwin/workflow-engine';
import { SafeExecutionException } from '@tasktwin/workflow-engine';
import type { VerifyStep } from '@tasktwin/workflow-schema';
import {
  MAX_VERIFICATION_ATTEMPTS,
  SafeVerificationResultSchema,
  VERIFICATION_POLL_INTERVAL_MS,
  compareVerificationFieldValue,
  compareVerificationText,
  compareVerificationUrls,
  textMatchMode,
  urlMatchMode,
  type SafeObservedState,
  type SafeVerificationResult,
} from '@tasktwin/workflow-verification';
import type { Locator, Page } from 'playwright';

import { PlaywrightLocatorAdapter } from './locator-adapter.js';

export interface VerificationExecutionContext {
  page: Page;
  valueResolver: WorkflowRuntimeValueResolver;
  effectiveTimeoutMs: number;
  actionTimeoutMs: number;
  signal?: AbortSignal;
}

interface AttemptResult {
  matched: boolean;
  observedState?: SafeObservedState;
}

function safeResult(
  step: VerifyStep,
  outcome: SafeVerificationResult['outcome'],
  attemptCount: number,
  durationMs: number,
  observedState?: SafeObservedState,
): SafeVerificationResult {
  const kind =
    step.assertion.kind === 'visible' || step.assertion.kind === 'hidden'
      ? 'visibility'
      : step.assertion.kind === 'value'
        ? 'fieldValue'
        : step.assertion.kind;
  return SafeVerificationResultSchema.parse({
    schemaVersion: 1,
    kind,
    outcome,
    attemptCount,
    durationMs,
    ...(observedState === undefined ? {} : { observedState }),
  });
}

function abortError(): SafeExecutionException {
  return new SafeExecutionException('EXECUTION_CANCELLED');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError();
}

async function waitForNextAttempt(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function uniqueOrAbsent(locator: Locator): Promise<Locator | null> {
  const count = await locator.count();
  if (count > 1) throw new SafeExecutionException('LOCATOR_NOT_UNIQUE');
  if (count === 0) return null;
  return locator;
}

async function attemptElementRule(
  step: VerifyStep,
  locator: Locator,
  expected: string | number | boolean | undefined,
): Promise<AttemptResult> {
  const assertion = step.assertion;
  if (assertion.kind === 'hidden') {
    const selected = await uniqueOrAbsent(locator);
    if (selected === null) return { matched: true, observedState: 'absent' };
    const visible = await selected.isVisible();
    return {
      matched: !visible,
      observedState: visible ? 'visible' : 'hidden',
    };
  }
  const selected = await uniqueOrAbsent(locator);
  if (selected === null) return { matched: false };
  switch (assertion.kind) {
    case 'visible': {
      const visible = await selected.isVisible();
      return {
        matched: visible,
        observedState: visible ? 'visible' : 'hidden',
      };
    }
    case 'text': {
      const mode = textMatchMode(step);
      if (mode === null || typeof expected !== 'string') {
        throw new SafeExecutionException('VERIFICATION_EXPECTATION_INVALID');
      }
      return {
        matched: compareVerificationText(
          await selected.innerText({ timeout: 0 }),
          expected,
          mode,
        ),
      };
    }
    case 'value': {
      const type = (await selected.getAttribute('type'))?.toLowerCase();
      if (type === 'password') {
        throw new SafeExecutionException('VERIFICATION_TARGET_UNSUPPORTED');
      }
      if (expected === undefined) {
        throw new SafeExecutionException('VERIFICATION_EXPECTATION_INVALID');
      }
      let actual: string;
      try {
        actual = await selected.inputValue({ timeout: 0 });
      } catch {
        throw new SafeExecutionException('VERIFICATION_TARGET_UNSUPPORTED');
      }
      return { matched: compareVerificationFieldValue(actual, expected) };
    }
    case 'checked': {
      let checked: boolean;
      try {
        checked = await selected.isChecked({ timeout: 0 });
      } catch {
        throw new SafeExecutionException('VERIFICATION_TARGET_UNSUPPORTED');
      }
      return {
        matched: checked === assertion.expected,
        observedState: checked ? 'checked' : 'unchecked',
      };
    }
    default:
      throw new SafeExecutionException('VERIFICATION_RULE_INVALID');
  }
}

function resolveExpected(
  step: VerifyStep,
  resolver: WorkflowRuntimeValueResolver,
): string | number | boolean | undefined {
  const assertion = step.assertion;
  if (
    assertion.kind !== 'url' &&
    assertion.kind !== 'text' &&
    assertion.kind !== 'value'
  ) {
    return undefined;
  }
  return resolver.resolve(
    assertion.expected,
    `verify.${assertion.kind}.expected`,
  );
}

export async function executeVerification(
  step: VerifyStep,
  context: VerificationExecutionContext,
): Promise<SafeVerificationResult> {
  throwIfAborted(context.signal);
  const expected = resolveExpected(step, context.valueResolver);
  const requestedTimeout = step.timeoutMs ?? context.effectiveTimeoutMs;
  const timeoutMs = Math.min(requestedTimeout, context.effectiveTimeoutMs);
  const verificationOwnsDeadline =
    step.timeoutMs !== undefined &&
    step.timeoutMs <= context.effectiveTimeoutMs;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const locator =
    'locator' in step.assertion
      ? new PlaywrightLocatorAdapter(
          context.page,
          Math.min(context.actionTimeoutMs, timeoutMs),
        ).create(step.assertion.locator)
      : null;

  for (
    let attemptCount = 1;
    attemptCount <= MAX_VERIFICATION_ATTEMPTS;
    attemptCount += 1
  ) {
    throwIfAborted(context.signal);
    let attempt: AttemptResult;
    if (step.assertion.kind === 'url') {
      const mode = urlMatchMode(step);
      if (mode === null || typeof expected !== 'string') {
        throw new SafeExecutionException('VERIFICATION_EXPECTATION_INVALID');
      }
      attempt = {
        matched: compareVerificationUrls(context.page.url(), expected, mode),
      };
    } else {
      if (locator === null) {
        throw new SafeExecutionException('VERIFICATION_RULE_INVALID');
      }
      attempt = await attemptElementRule(step, locator, expected);
    }
    const now = Date.now();
    if (attempt.matched) {
      return safeResult(
        step,
        'matched',
        attemptCount,
        Math.max(0, now - startedAt),
        attempt.observedState,
      );
    }
    if (now >= deadline || attemptCount === MAX_VERIFICATION_ATTEMPTS) {
      const result = safeResult(
        step,
        'not_matched',
        attemptCount,
        Math.max(0, now - startedAt),
        attempt.observedState,
      );
      throw new SafeExecutionException(
        verificationOwnsDeadline ? 'VERIFICATION_NOT_MATCHED' : 'STEP_TIMEOUT',
        result,
      );
    }
    await waitForNextAttempt(
      Math.min(VERIFICATION_POLL_INTERVAL_MS, Math.max(1, deadline - now)),
      context.signal,
    );
  }
  throw new SafeExecutionException('VERIFICATION_RULE_INVALID');
}
