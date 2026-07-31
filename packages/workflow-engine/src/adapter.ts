import type { RuntimeInputValue } from '@tasktwin/workflow-inputs';
import type { WorkflowStep } from '@tasktwin/workflow-schema';

import type {
  SafeExecutionError,
  TerminationCause,
  WorkflowStepType,
} from './contracts.js';

export type SafeRuntimeInputs = Readonly<Record<string, RuntimeInputValue>>;

export interface AdapterStartContext {
  executionId: string;
  runtimeInputs: SafeRuntimeInputs;
  allowedOrigins: readonly string[];
  totalTimeoutMs: number;
  remainingTimeMs: number;
  signal: AbortSignal;
}

export interface AdapterStepContext extends AdapterStartContext {
  step: WorkflowStep;
  effectiveTimeoutMs: number;
}

export interface AdapterStopContext {
  executionId: string;
  terminationCause: TerminationCause;
}

export interface WorkflowExecutionAdapter {
  readonly supportedStepTypes: readonly WorkflowStepType[];
  validateStep(step: WorkflowStep): void;
  start(context: AdapterStartContext): Promise<void>;
  executeStep(context: AdapterStepContext): Promise<void>;
  stop(context: AdapterStopContext): Promise<SafeExecutionError | null>;
}
