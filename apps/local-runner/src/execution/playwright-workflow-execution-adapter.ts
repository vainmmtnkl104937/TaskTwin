import {
  SafeExecutionException,
  type AdapterStartContext,
  type AdapterStepContext,
  type SafeExecutionError,
  type WorkflowExecutionAdapter,
  type WorkflowStepType,
} from '@tasktwin/workflow-engine';
import type { WorkflowStep } from '@tasktwin/workflow-schema';

import type {
  BrowserSession,
  BrowserSessionFactory,
} from './browser-session.js';
import type { BrowserExecutionOptions } from './contracts.js';
import { validateExecutableLocator } from './locator-adapter.js';
import { executeStep, type SupportedWorkflowStep } from './step-executor.js';

const SUPPORTED_STEP_TYPES = [
  'navigate',
  'click',
  'fill',
  'select',
  'setChecked',
  'wait',
] as const satisfies readonly WorkflowStepType[];

function isSupportedStep(step: WorkflowStep): step is SupportedWorkflowStep {
  return SUPPORTED_STEP_TYPES.includes(
    step.type as (typeof SUPPORTED_STEP_TYPES)[number],
  );
}

export class PlaywrightWorkflowExecutionAdapter implements WorkflowExecutionAdapter {
  readonly supportedStepTypes = SUPPORTED_STEP_TYPES;
  private session: BrowserSession | null = null;
  private startSignal: AbortSignal | null = null;
  private abortListener: (() => void) | null = null;

  constructor(
    private readonly sessions: BrowserSessionFactory,
    private readonly options: BrowserExecutionOptions,
  ) {}

  validateStep(step: WorkflowStep): void {
    if (!isSupportedStep(step)) {
      throw new SafeExecutionException('UNSUPPORTED_STEP_TYPE');
    }
    if ('locator' in step) {
      validateExecutableLocator(step.locator);
    }
  }

  async start(context: AdapterStartContext): Promise<void> {
    if (this.session !== null) {
      throw new SafeExecutionException('ADAPTER_START_FAILED');
    }
    const session = await this.sessions.create({
      ...this.options,
      navigationTimeoutMs: Math.max(
        1,
        Math.min(this.options.navigationTimeoutMs, context.remainingTimeMs),
      ),
    });
    this.session = session;
    this.startSignal = context.signal;
    this.abortListener = () => {
      void session.close();
    };
    context.signal.addEventListener('abort', this.abortListener, {
      once: true,
    });
    if (context.signal.aborted) {
      await session.close();
      throw new SafeExecutionException('EXECUTION_CANCELLED');
    }
  }

  async executeStep(context: AdapterStepContext): Promise<void> {
    const session = this.session;
    if (session === null || !isSupportedStep(context.step)) {
      throw new SafeExecutionException('ACTION_FAILED');
    }
    await executeStep(context.step, {
      page: session.page,
      runtimeValues: context.runtimeInputs,
      allowedOrigins: context.allowedOrigins,
      options: this.options,
      effectiveTimeoutMs: context.effectiveTimeoutMs,
      signal: context.signal,
    });
  }

  async stop(): Promise<SafeExecutionError | null> {
    if (this.abortListener !== null && this.startSignal !== null) {
      this.startSignal.removeEventListener('abort', this.abortListener);
    }
    this.abortListener = null;
    this.startSignal = null;
    const session = this.session;
    this.session = null;
    return session === null ? null : session.close();
  }
}
