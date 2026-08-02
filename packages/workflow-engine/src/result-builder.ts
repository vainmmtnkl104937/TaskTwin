import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import type { SafeVerificationResult } from '@tasktwin/workflow-verification';
import {
  defineWorkflowOutputs,
  type SafeWorkflowOutputSummary,
} from '@tasktwin/workflow-extraction';

import {
  TerminalStepStatusSchema,
  WorkflowExecutionResultSchema,
  type SafeExecutionError,
  type SkippedStepReason,
  type StepExecutionResult,
  type TerminationCause,
  type WorkflowEngineStepStatus,
  type WorkflowEngineWarning,
  type WorkflowExecutionResult,
} from './contracts.js';
import { WORKFLOW_ENGINE_SCHEMA_VERSION } from './constants.js';
import { timestampFromMs } from './clock.js';

export interface ExecutionStepRecord {
  step: WorkflowDefinition['steps'][number];
  status: WorkflowEngineStepStatus;
  startedAtMs?: number;
  finishedAtMs?: number;
  skippedReason?: SkippedStepReason;
  error?: SafeExecutionError;
  verification?: SafeVerificationResult;
}

export interface FinalResultInput {
  executionId: string;
  workflow?: WorkflowDefinition;
  status: WorkflowExecutionResult['status'];
  startedAtMs: number;
  finishedAtMs: number;
  terminationCause: TerminationCause;
  records: readonly ExecutionStepRecord[];
  warnings: readonly WorkflowEngineWarning[];
  error?: SafeExecutionError;
  failedStepId?: string;
  outputs?: readonly SafeWorkflowOutputSummary[];
}

function locatorKind(
  step: WorkflowDefinition['steps'][number],
): StepExecutionResult['locatorKind'] {
  if ('locator' in step && step.locator !== undefined) return step.locator.kind;
  if (step.type === 'verify' && 'locator' in step.assertion) {
    return step.assertion.locator.kind;
  }
  return undefined;
}

function stepResult(record: ExecutionStepRecord): StepExecutionResult {
  const status = TerminalStepStatusSchema.parse(record.status);
  const finishedAtMs = record.finishedAtMs;
  if (finishedAtMs === undefined) {
    throw new Error('A terminal step result requires a finish timestamp.');
  }
  const startedAtMs = record.startedAtMs;
  const kind = locatorKind(record.step);
  return {
    stepId: record.step.id,
    stepType: record.step.type,
    status,
    ...(startedAtMs === undefined
      ? {}
      : { startedAt: timestampFromMs(startedAtMs) }),
    finishedAt: timestampFromMs(finishedAtMs),
    durationMs:
      startedAtMs === undefined ? 0 : Math.max(0, finishedAtMs - startedAtMs),
    ...(kind === undefined ? {} : { locatorKind: kind }),
    ...(record.skippedReason === undefined
      ? {}
      : { skippedReason: record.skippedReason }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.verification === undefined
      ? {}
      : { verification: record.verification }),
  };
}

export function buildWorkflowExecutionResult(
  input: FinalResultInput,
): WorkflowExecutionResult {
  const steps = input.records.map(stepResult);
  const counts = {
    total: steps.length,
    attempted: steps.filter((step) => step.status !== 'skipped').length,
    succeeded: steps.filter((step) => step.status === 'succeeded').length,
    failed: steps.filter((step) => step.status === 'failed').length,
    cancelled: steps.filter((step) => step.status === 'cancelled').length,
    timedOut: steps.filter((step) => step.status === 'timed_out').length,
    skipped: steps.filter((step) => step.status === 'skipped').length,
  };
  return WorkflowExecutionResultSchema.parse({
    schemaVersion: WORKFLOW_ENGINE_SCHEMA_VERSION,
    executionId: input.executionId,
    workflowId: input.workflow?.workflowId ?? null,
    workflowVersion: input.workflow?.version ?? null,
    status: input.status,
    startedAt: timestampFromMs(input.startedAtMs),
    finishedAt: timestampFromMs(input.finishedAtMs),
    durationMs: Math.max(0, input.finishedAtMs - input.startedAtMs),
    terminationCause: input.terminationCause,
    counts,
    ...(input.failedStepId === undefined
      ? {}
      : { failedStepId: input.failedStepId }),
    ...(input.error === undefined ? {} : { error: input.error }),
    warnings: input.warnings,
    steps,
    outputs:
      input.outputs ??
      (input.workflow === undefined
        ? []
        : defineWorkflowOutputs(input.workflow).map((output) => ({
            outputName: output.name,
            outputType: output.valueType,
            producerStepId: output.producerStepId,
            status: 'not_produced' as const,
          }))),
  });
}
