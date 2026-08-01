import type { WorkflowStep } from '@tasktwin/workflow-schema';
import type { SafeVerificationResult } from '@tasktwin/workflow-verification';

import type {
  SafeExecutionError,
  TerminationCause,
  WorkflowStepType,
} from './contracts.js';
import type { WorkflowRuntimeValueResolver } from './value-source-resolver.js';

export interface AdapterStartContext {
  executionId: string;
  valueResolver: WorkflowRuntimeValueResolver;
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

export interface AdapterStepOutput {
  verification?: SafeVerificationResult;
}

export interface WorkflowExecutionAdapter {
  readonly supportedStepTypes: readonly WorkflowStepType[];
  validateStep(step: WorkflowStep): void;
  start(context: AdapterStartContext): Promise<void>;
  executeStep(context: AdapterStepContext): Promise<AdapterStepOutput | void>;
  stop(context: AdapterStopContext): Promise<SafeExecutionError | null>;
}
