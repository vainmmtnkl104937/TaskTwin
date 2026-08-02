import { outputTypeForExtractStep } from '@tasktwin/workflow-extraction';
import { SafeExecutionException } from '@tasktwin/workflow-engine';
import type { ExtractStep } from '@tasktwin/workflow-schema';
import type { Locator, Page } from 'playwright';

import { PlaywrightLocatorAdapter } from './locator-adapter.js';

const POLL_INTERVAL_MS = 100;

export interface ExtractionExecutionContext {
  page: Page;
  allowedOrigins: readonly string[];
  effectiveTimeoutMs: number;
  actionTimeoutMs: number;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new SafeExecutionException('EXECUTION_CANCELLED');
  }
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new SafeExecutionException('EXECUTION_CANCELLED'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function resolveUniqueForExtraction(
  step: ExtractStep,
  context: ExtractionExecutionContext,
): Promise<Locator> {
  if (step.locator === undefined) {
    throw new SafeExecutionException('EXTRACTION_TARGET_UNSUPPORTED');
  }
  const locator = new PlaywrightLocatorAdapter(
    context.page,
    Math.min(context.actionTimeoutMs, context.effectiveTimeoutMs),
  ).create(step.locator);
  const timeoutMs = Math.min(
    step.timeoutMs ?? context.effectiveTimeoutMs,
    context.effectiveTimeoutMs,
  );
  const deadline = Date.now() + timeoutMs;
  while (true) {
    throwIfAborted(context.signal);
    const count = await locator.count();
    if (count > 1) throw new SafeExecutionException('LOCATOR_NOT_UNIQUE');
    if (count === 1) return locator;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SafeExecutionException('LOCATOR_NOT_FOUND');
    }
    await wait(Math.min(POLL_INTERVAL_MS, remaining), context.signal);
  }
}

function safeCurrentUrl(
  page: Page,
  allowedOrigins: readonly string[],
  mode: 'origin' | 'origin_and_path',
): string {
  let url: URL;
  try {
    url = new URL(page.url());
  } catch {
    throw new SafeExecutionException('EXTRACTION_VALUE_UNAVAILABLE');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new SafeExecutionException('EXTRACTION_TARGET_UNSUPPORTED');
  }
  if (!allowedOrigins.includes(url.origin)) {
    throw new SafeExecutionException('ORIGIN_NOT_ALLOWED');
  }
  return mode === 'origin' ? url.origin : `${url.origin}${url.pathname}`;
}

export async function executeExtraction(
  step: ExtractStep,
  context: ExtractionExecutionContext,
): Promise<{
  outputName: string;
  outputType: 'string' | 'boolean';
  value: string | boolean;
}> {
  throwIfAborted(context.signal);
  const outputType = outputTypeForExtractStep(step);
  if (outputType === null) {
    throw new SafeExecutionException('EXTRACTION_TARGET_UNSUPPORTED');
  }
  if (step.source.kind === 'url') {
    return {
      outputName: step.outputName,
      outputType,
      value: safeCurrentUrl(
        context.page,
        context.allowedOrigins,
        step.source.mode,
      ),
    };
  }

  const locator = await resolveUniqueForExtraction(step, context);
  try {
    if (step.source.kind === 'text') {
      const value = (await locator.innerText({ timeout: 0 }))
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n')
        .trim();
      return { outputName: step.outputName, outputType, value };
    }
    if (step.source.kind === 'value') {
      const type = (await locator.getAttribute('type'))?.toLowerCase();
      if (type === 'password') {
        throw new SafeExecutionException('EXTRACTION_TARGET_UNSUPPORTED');
      }
      const value = await locator.inputValue({ timeout: 0 });
      return { outputName: step.outputName, outputType, value };
    }
    if (step.source.kind === 'checked') {
      const value = await locator.isChecked({ timeout: 0 });
      return { outputName: step.outputName, outputType, value };
    }
    throw new SafeExecutionException('EXTRACTION_TARGET_UNSUPPORTED');
  } catch (error: unknown) {
    if (error instanceof SafeExecutionException) throw error;
    throw new SafeExecutionException('EXTRACTION_TARGET_UNSUPPORTED');
  }
}
