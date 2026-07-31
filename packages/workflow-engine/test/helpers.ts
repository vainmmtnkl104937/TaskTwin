import type {
  AdapterStartContext,
  AdapterStepContext,
  SafeExecutionError,
  WorkflowEngineClock,
  WorkflowEngineTimer,
  WorkflowExecutionAdapter,
  WorkflowExecutionRequest,
  WorkflowStepType,
} from '../src/index.js';
import { SafeExecutionException } from '../src/index.js';

export const EXECUTION_ID = '00000000-0000-4000-8000-000000000016';

export function clickStep(id: string) {
  return {
    id,
    type: 'click' as const,
    name: `Step ${id}`,
    locator: { kind: 'testId' as const, value: id },
  };
}

export function executionRequest(
  stepIds: readonly string[] = ['first', 'second', 'third'],
): WorkflowExecutionRequest {
  return {
    schemaVersion: 1,
    workflow: {
      schemaVersion: 1,
      workflowId: 'engineTest',
      version: 1,
      name: 'Engine test',
      status: 'draft',
      variables: [],
      steps: stepIds.map(clickStep),
    },
    inputs: {
      schemaVersion: 1,
      values: {},
    },
    allowedOrigins: ['http://127.0.0.1:4177'],
    options: {
      totalTimeoutMs: 10_000,
      stepTimeoutMs: 1_000,
    },
  };
}

export type StepBehavior = 'succeed' | 'fail' | 'timeout' | 'wait-for-abort';

export class FakeAdapter implements WorkflowExecutionAdapter {
  readonly supportedStepTypes = [
    'navigate',
    'click',
    'fill',
    'select',
    'setChecked',
    'wait',
  ] as const satisfies readonly WorkflowStepType[];
  readonly executed: string[] = [];
  readonly effectiveTimeouts: number[] = [];
  startCount = 0;
  stopCount = 0;
  activeSteps = 0;
  maxActiveSteps = 0;
  cleanupError: SafeExecutionError | null = null;
  startBehavior: 'succeed' | 'fail' | 'wait-for-abort' = 'succeed';
  readonly behavior = new Map<string, StepBehavior>();

  validateStep(): void {}

  async start(context: AdapterStartContext): Promise<void> {
    this.startCount += 1;
    if (this.startBehavior === 'fail') {
      throw new SafeExecutionException('ADAPTER_START_FAILED');
    }
    if (this.startBehavior === 'wait-for-abort') {
      await rejectOnAbort(context.signal);
    }
  }

  async executeStep(context: AdapterStepContext): Promise<void> {
    this.executed.push(context.step.id);
    this.effectiveTimeouts.push(context.effectiveTimeoutMs);
    this.activeSteps += 1;
    this.maxActiveSteps = Math.max(this.maxActiveSteps, this.activeSteps);
    try {
      switch (this.behavior.get(context.step.id) ?? 'succeed') {
        case 'succeed':
          return;
        case 'fail':
          throw new SafeExecutionException('ACTION_FAILED');
        case 'timeout':
          throw new SafeExecutionException('ACTION_TIMEOUT');
        case 'wait-for-abort':
          await rejectOnAbort(context.signal);
      }
    } finally {
      this.activeSteps -= 1;
    }
  }

  async stop(): Promise<SafeExecutionError | null> {
    this.stopCount += 1;
    return this.cleanupError;
  }
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new SafeExecutionException('EXECUTION_CANCELLED'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(new SafeExecutionException('EXECUTION_CANCELLED')),
      { once: true },
    );
  });
}

export class ManualClock implements WorkflowEngineClock {
  private currentMs = Date.parse('2026-01-01T00:00:00.000Z');
  private sequence = 0;
  private readonly timers: Array<{
    id: number;
    dueMs: number;
    callback: () => void;
    cancelled: boolean;
  }> = [];

  nowMs(): number {
    return this.currentMs;
  }

  schedule(callback: () => void, delayMs: number): WorkflowEngineTimer {
    const timer = {
      id: this.sequence,
      dueMs: this.currentMs + delayMs,
      callback,
      cancelled: false,
    };
    this.sequence += 1;
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  advance(milliseconds: number): void {
    this.currentMs += milliseconds;
    const due = this.timers
      .filter((timer) => !timer.cancelled && timer.dueMs <= this.currentMs)
      .sort((left, right) => left.dueMs - right.dueMs || left.id - right.id);
    for (const timer of due) {
      timer.cancelled = true;
      timer.callback();
    }
  }
}

export async function waitFor(
  condition: () => boolean,
  attempts = 20,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('The test condition was not reached.');
}
