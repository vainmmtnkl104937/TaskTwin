import { randomUUID } from 'node:crypto';

import {
  analyzeWorkflowInputs,
  validateWorkflowRunInputs,
  type RuntimeInputValue,
} from '@tasktwin/workflow-inputs';

import type { BrowserSessionFactory } from './browser-session.js';
import {
  LocalExecutionRequestSchema,
  LocalWorkflowExecutionResultSchema,
  type LocalExecutionRequest,
  type LocalWorkflowExecutionResult,
  type StepExecutionResult,
} from './contracts.js';
import { SafeExecutionException, safeError } from './errors.js';
import { validateExecutableLocator } from './locator-adapter.js';
import {
  normalizeAllowedOrigins,
  validateNavigationUrl,
} from './origin-policy.js';
import {
  executeStep,
  stepLocatorKind,
  type SupportedWorkflowStep,
} from './step-executor.js';
import {
  resolveSelectValue,
  resolveTextValue,
} from './value-source-resolver.js';

export interface PreparedExecution {
  request: LocalExecutionRequest;
  runtimeValues: ReadonlyMap<string, RuntimeInputValue>;
  allowedOrigins: ReadonlySet<string>;
  steps: SupportedWorkflowStep[];
}

function isSupportedStep(
  step: LocalExecutionRequest['workflow']['steps'][number],
): step is SupportedWorkflowStep {
  return (
    step.type === 'navigate' ||
    step.type === 'click' ||
    step.type === 'fill' ||
    step.type === 'select' ||
    step.type === 'setChecked' ||
    step.type === 'wait'
  );
}

export function prepareLocalExecution(input: unknown): PreparedExecution {
  const parsed = LocalExecutionRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new SafeExecutionException('INVALID_EXECUTION_REQUEST');
  }
  const request = parsed.data;
  const analysis = analyzeWorkflowInputs(request.workflow);
  if (analysis.hasBlockingIssues) {
    throw new SafeExecutionException('INVALID_WORKFLOW');
  }
  if (analysis.secretRequirements.length > 0) {
    throw new SafeExecutionException('SECRET_RESOLUTION_UNAVAILABLE');
  }
  const inputValidation = validateWorkflowRunInputs(
    request.workflow,
    request.inputs,
  );
  if (!inputValidation.summary.valid) {
    throw new SafeExecutionException('INVALID_RUNTIME_INPUTS');
  }

  const runtimeValues = new Map(Object.entries(request.inputs.values));
  const allowedOrigins = normalizeAllowedOrigins(request.allowedOrigins);
  const steps: SupportedWorkflowStep[] = [];
  for (const step of request.workflow.steps) {
    if (!isSupportedStep(step)) {
      throw new SafeExecutionException('UNSUPPORTED_STEP_TYPE');
    }
    if ('locator' in step) {
      validateExecutableLocator(step.locator);
    }
    if (step.type === 'navigate') {
      validateNavigationUrl(
        resolveTextValue(step.url, 'navigate.url', runtimeValues),
        allowedOrigins,
      );
    } else if (step.type === 'fill') {
      resolveTextValue(step.value, 'fill.value', runtimeValues);
    } else if (step.type === 'select') {
      resolveSelectValue(step.value, runtimeValues);
    }
    steps.push(step);
  }
  return { request, runtimeValues, allowedOrigins, steps };
}

export class LocalWorkflowExecutor {
  constructor(private readonly sessions: BrowserSessionFactory) {}

  async execute(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<LocalWorkflowExecutionResult> {
    const prepared = prepareLocalExecution(input);
    const startedAt = new Date();
    const context = {
      executionId: randomUUID(),
      workflowId: prepared.request.workflow.workflowId,
      workflowVersion: prepared.request.workflow.version,
      startedAt: startedAt.toISOString(),
      declaredStepCount: prepared.steps.length,
      allowedOriginCount: prepared.allowedOrigins.size,
    };
    const session = await this.sessions.create(prepared.request.options);
    let cleanupError = null;
    let failedStepId: string | undefined;
    const results: StepExecutionResult[] = [];
    const executionController = new AbortController();
    const timeout = setTimeout(
      () => executionController.abort(),
      prepared.request.options.executionTimeoutMs,
    );
    const forwardAbort = () => executionController.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const closeOnAbort = () => {
      void session.close();
    };
    executionController.signal.addEventListener('abort', closeOnAbort, {
      once: true,
    });

    try {
      for (const step of prepared.steps) {
        const stepStartedAt = new Date();
        try {
          await executeStep(step, {
            page: session.page,
            runtimeValues: prepared.runtimeValues,
            allowedOrigins: prepared.allowedOrigins,
            options: prepared.request.options,
            signal: executionController.signal,
          });
          const finishedAt = new Date();
          results.push({
            stepId: step.id,
            stepType: step.type,
            status: 'succeeded',
            startedAt: stepStartedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: Math.max(
              0,
              finishedAt.getTime() - stepStartedAt.getTime(),
            ),
            ...(stepLocatorKind(step) === undefined
              ? {}
              : { locatorKind: stepLocatorKind(step) }),
          });
        } catch (error: unknown) {
          const safe =
            error instanceof SafeExecutionException
              ? error.safe
              : safeError('ACTION_FAILED');
          const finishedAt = new Date();
          failedStepId = step.id;
          results.push({
            stepId: step.id,
            stepType: step.type,
            status: 'failed',
            startedAt: stepStartedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: Math.max(
              0,
              finishedAt.getTime() - stepStartedAt.getTime(),
            ),
            ...(stepLocatorKind(step) === undefined
              ? {}
              : { locatorKind: stepLocatorKind(step) }),
            error: safe,
          });
          break;
        }
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
      executionController.signal.removeEventListener('abort', closeOnAbort);
      cleanupError = await session.close();
    }

    const finishedAt = new Date();
    const status =
      failedStepId === undefined && cleanupError === null
        ? 'succeeded'
        : 'failed';
    return LocalWorkflowExecutionResultSchema.parse({
      schemaVersion: 1,
      context,
      status,
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      attemptedStepCount: results.length,
      ...(failedStepId === undefined ? {} : { failedStepId }),
      steps: results,
      ...(cleanupError === null ? {} : { cleanupError }),
    });
  }
}
