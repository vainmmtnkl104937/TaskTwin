import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import {
  defineWorkflowOutputs,
  outputTypeForExtractStep,
  type SafeWorkflowOutputSummary,
  type WorkflowOutputDefinition,
} from '@tasktwin/workflow-extraction';

import type { WorkflowExecutionAdapter } from './adapter.js';
import {
  type ExecutionErrorCode,
  type SafeExecutionError,
  type SkippedStepReason,
  type TerminationCause,
  type WorkflowEngineRunStatus,
  type WorkflowEngineStepStatus,
  type WorkflowExecutionResult,
} from './contracts.js';
import {
  systemWorkflowEngineClock,
  timestampFromMs,
  type WorkflowEngineClock,
} from './clock.js';
import { SafeExecutionException, safeError, toSafeError } from './errors.js';
import {
  findTypedWorkflow,
  preflightWorkflowExecution,
  type PreparedWorkflowExecution,
} from './preflight.js';
import { SafeProgressEmitter, type WorkflowProgressSink } from './progress.js';
import {
  buildWorkflowExecutionResult,
  type ExecutionStepRecord,
} from './result-builder.js';
import { RunStateMachine } from './run-state-machine.js';
import { StepStateMachine } from './step-state-machine.js';
import { TerminationArbiter } from './termination-arbiter.js';
import type { WorkflowRuntimeValueResolver } from './value-source-resolver.js';
import { withRuntimeOutputs } from './value-source-resolver.js';
import { RuntimeOutputStore } from './runtime-output-store.js';
import type { WorkflowApprovalCoordinator } from './approval-coordinator.js';
import {
  ApprovalCoordinatorResultSchema,
  requireApprovalBinding,
  type ApprovalRequestStatus,
} from '@tasktwin/workflow-approval';

const TIMEOUT_ERROR_CODES = new Set<ExecutionErrorCode>([
  'ACTION_TIMEOUT',
  'NAVIGATION_TIMEOUT',
  'STEP_TIMEOUT',
]);

export interface WorkflowEngineDependencies {
  createExecutionId(): string;
  createRuntimeOutputStore?(
    definitions: readonly WorkflowOutputDefinition[],
  ): RuntimeOutputStore;
  clock?: WorkflowEngineClock;
  progressSink?: WorkflowProgressSink;
  valueResolver?: WorkflowRuntimeValueResolver;
  approvalCoordinator?: WorkflowApprovalCoordinator;
}

interface PrimaryTermination {
  cause: Exclude<
    TerminationCause,
    'completed' | 'preflight_failed' | 'cleanup_failed'
  >;
  error: SafeExecutionError;
  stepId?: string;
}

function createRecords(
  workflow: WorkflowDefinition | undefined,
): ExecutionStepRecord[] {
  return (
    workflow?.steps.map((step) => ({
      step,
      status: 'pending' as const,
    })) ?? []
  );
}

function signalIsAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function skipReasonFor(cause: PrimaryTermination['cause']): SkippedStepReason {
  switch (cause) {
    case 'adapter_start_failed':
      return 'adapter_start_failed';
    case 'run_cancelled':
      return 'run_cancelled';
    case 'total_timeout':
      return 'run_timed_out';
    case 'approval_rejected':
      return 'approval_rejected';
    case 'approval_expired':
      return 'approval_expired';
    case 'approval_invalidated':
      return 'approval_invalidated';
    case 'step_failed':
    case 'step_timeout':
      return 'prior_step_failed';
  }
}

function terminalStatusFor(
  cause: PrimaryTermination['cause'],
): WorkflowExecutionResult['status'] {
  switch (cause) {
    case 'run_cancelled':
      return 'cancelled';
    case 'total_timeout':
      return 'timed_out';
    case 'approval_rejected':
      return 'cancelled';
    case 'approval_expired':
      return 'timed_out';
    case 'approval_invalidated':
      return 'interrupted';
    case 'adapter_start_failed':
    case 'step_failed':
    case 'step_timeout':
      return 'failed';
  }
}

export class WorkflowEngine {
  private readonly clock: WorkflowEngineClock;

  constructor(
    private readonly adapter: WorkflowExecutionAdapter,
    private readonly dependencies: WorkflowEngineDependencies,
  ) {
    this.clock = dependencies.clock ?? systemWorkflowEngineClock;
  }

  async execute(
    input: unknown,
    externalSignal?: AbortSignal,
  ): Promise<WorkflowExecutionResult> {
    const executionId = this.dependencies.createExecutionId();
    const startedAtMs = this.clock.nowMs();
    const progress = new SafeProgressEmitter(this.dependencies.progressSink);
    const run = new RunStateMachine();

    const emitRun = (
      status: WorkflowEngineRunStatus,
      error?: SafeExecutionError,
    ) => {
      progress.emit({
        kind: 'run_status_changed',
        executionId,
        timestamp: timestampFromMs(this.clock.nowMs()),
        status,
        ...(error === undefined ? {} : { errorCode: error.code }),
      });
    };
    const transitionRun = (
      status: WorkflowEngineRunStatus,
      error?: SafeExecutionError,
    ) => {
      run.transition(status);
      emitRun(status, error);
    };

    emitRun('pending');

    if (signalIsAborted(externalSignal)) {
      const workflow = findTypedWorkflow(input);
      const records = createRecords(workflow);
      const steps = this.initializeSteps(records, executionId, progress);
      transitionRun('cancelling');
      this.skipPending(records, steps, 'run_cancelled', executionId, progress);
      transitionRun('cancelled', safeError('EXECUTION_CANCELLED'));
      return buildWorkflowExecutionResult({
        executionId,
        ...(workflow === undefined ? {} : { workflow }),
        status: 'cancelled',
        startedAtMs,
        finishedAtMs: this.clock.nowMs(),
        terminationCause: 'run_cancelled',
        records,
        warnings: progress.warnings(),
        error: safeError('EXECUTION_CANCELLED'),
      });
    }

    transitionRun('validating');
    const preflight = preflightWorkflowExecution(
      input,
      this.adapter,
      this.dependencies.valueResolver,
      this.dependencies.approvalCoordinator !== undefined,
    );
    const workflow = preflight.ok
      ? preflight.prepared.request.workflow
      : preflight.workflow;
    const records = createRecords(workflow);
    const steps = this.initializeSteps(records, executionId, progress);

    if (signalIsAborted(externalSignal)) {
      transitionRun('cancelling');
      this.skipPending(records, steps, 'run_cancelled', executionId, progress);
      transitionRun('cancelled', safeError('EXECUTION_CANCELLED'));
      return buildWorkflowExecutionResult({
        executionId,
        ...(workflow === undefined ? {} : { workflow }),
        status: 'cancelled',
        startedAtMs,
        finishedAtMs: this.clock.nowMs(),
        terminationCause: 'run_cancelled',
        records,
        warnings: progress.warnings(),
        error: safeError('EXECUTION_CANCELLED'),
      });
    }

    if (!preflight.ok) {
      this.skipPending(
        records,
        steps,
        'preflight_failed',
        executionId,
        progress,
      );
      transitionRun('failed', preflight.error);
      return buildWorkflowExecutionResult({
        executionId,
        ...(workflow === undefined ? {} : { workflow }),
        status: 'failed',
        startedAtMs,
        finishedAtMs: this.clock.nowMs(),
        terminationCause: 'preflight_failed',
        records,
        warnings: progress.warnings(),
        error: preflight.error,
      });
    }

    return this.executePrepared({
      prepared: preflight.prepared,
      executionId,
      startedAtMs,
      ...(externalSignal === undefined ? {} : { externalSignal }),
      records,
      steps,
      run,
      progress,
      emitRun,
      transitionRun,
    });
  }

  private initializeSteps(
    records: readonly ExecutionStepRecord[],
    executionId: string,
    progress: SafeProgressEmitter,
  ): StepStateMachine {
    const state = new StepStateMachine(
      records.map((record) => ({
        stepId: record.step.id,
        stepType: record.step.type,
      })),
    );
    for (const record of records) {
      progress.emit({
        kind: 'step_status_changed',
        executionId,
        timestamp: timestampFromMs(this.clock.nowMs()),
        stepId: record.step.id,
        stepType: record.step.type,
        status: 'pending',
      });
    }
    return state;
  }

  private transitionStep(
    record: ExecutionStepRecord,
    steps: StepStateMachine,
    status: WorkflowEngineStepStatus,
    executionId: string,
    progress: SafeProgressEmitter,
    error?: SafeExecutionError,
    skippedReason?: SkippedStepReason,
  ): void {
    steps.transition(record.step.id, status);
    record.status = status;
    progress.emit({
      kind: 'step_status_changed',
      executionId,
      timestamp: timestampFromMs(this.clock.nowMs()),
      stepId: record.step.id,
      stepType: record.step.type,
      status,
      ...(error === undefined ? {} : { errorCode: error.code }),
      ...(skippedReason === undefined ? {} : { skippedReason }),
    });
  }

  private skipPending(
    records: readonly ExecutionStepRecord[],
    steps: StepStateMachine,
    reason: SkippedStepReason,
    executionId: string,
    progress: SafeProgressEmitter,
  ): void {
    for (const record of records) {
      if (record.status !== 'pending') {
        continue;
      }
      record.skippedReason = reason;
      record.finishedAtMs = this.clock.nowMs();
      this.transitionStep(
        record,
        steps,
        'skipped',
        executionId,
        progress,
        undefined,
        reason,
      );
    }
  }

  private async executePrepared(context: {
    prepared: PreparedWorkflowExecution;
    executionId: string;
    startedAtMs: number;
    externalSignal?: AbortSignal;
    records: ExecutionStepRecord[];
    steps: StepStateMachine;
    run: RunStateMachine;
    progress: SafeProgressEmitter;
    emitRun: (
      status: WorkflowEngineRunStatus,
      error?: SafeExecutionError,
    ) => void;
    transitionRun: (
      status: WorkflowEngineRunStatus,
      error?: SafeExecutionError,
    ) => void;
  }): Promise<WorkflowExecutionResult> {
    const {
      prepared,
      executionId,
      startedAtMs,
      externalSignal,
      records,
      steps,
      run,
      progress,
      transitionRun,
    } = context;
    const controller = new AbortController();
    const outputDefinitions = defineWorkflowOutputs(prepared.request.workflow);
    const outputStore =
      this.dependencies.createRuntimeOutputStore?.(outputDefinitions) ??
      new RuntimeOutputStore(outputDefinitions);
    const executionValueResolver = withRuntimeOutputs(
      prepared.valueResolver,
      outputStore,
    );
    const arbiter = new TerminationArbiter();
    const executionStartedAtMs = this.clock.nowMs();
    const deadlineMs =
      executionStartedAtMs + prepared.request.options.totalTimeoutMs;
    const onExternalAbort = () => {
      arbiter.record({
        cause: 'run_cancelled',
        atMs: this.clock.nowMs(),
        error: safeError('EXECUTION_CANCELLED'),
      });
      controller.abort();
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    if (externalSignal?.aborted === true) {
      onExternalAbort();
    }
    const timer = this.clock.schedule(() => {
      arbiter.record({
        cause: 'total_timeout',
        atMs: deadlineMs,
        error: safeError('TOTAL_EXECUTION_TIMEOUT'),
      });
      controller.abort();
    }, prepared.request.options.totalTimeoutMs);

    let primary: PrimaryTermination | null = null;
    let cleanupError: SafeExecutionError | null = null;
    let adapterStartupAttempted = false;
    let outputSummaries: SafeWorkflowOutputSummary[] = outputStore.summaries();

    const recordDeadlineIfElapsed = () => {
      if (this.clock.nowMs() >= deadlineMs) {
        arbiter.record({
          cause: 'total_timeout',
          atMs: deadlineMs,
          error: safeError('TOTAL_EXECUTION_TIMEOUT'),
        });
        controller.abort();
      }
    };
    const choosePrimary = (): PrimaryTermination | null => {
      const winner = arbiter.lockWinner();
      return winner === null
        ? null
        : {
            cause: winner.cause,
            error: winner.error,
            ...(winner.stepId === undefined ? {} : { stepId: winner.stepId }),
          };
    };

    transitionRun('starting');
    try {
      adapterStartupAttempted = true;
      try {
        await this.adapter.start({
          executionId,
          valueResolver: executionValueResolver,
          allowedOrigins: prepared.allowedOrigins,
          totalTimeoutMs: prepared.request.options.totalTimeoutMs,
          remainingTimeMs: Math.max(0, deadlineMs - this.clock.nowMs()),
          signal: controller.signal,
        });
      } catch (error: unknown) {
        arbiter.record({
          cause: 'adapter_start_failed',
          atMs: this.clock.nowMs(),
          error: toSafeError(error, 'ADAPTER_START_FAILED'),
        });
      }
      recordDeadlineIfElapsed();
      primary = choosePrimary();

      if (primary === null) {
        transitionRun('running');
        for (const record of records) {
          recordDeadlineIfElapsed();
          primary = choosePrimary();
          if (primary !== null) {
            break;
          }

          const remainingTimeMs = Math.max(0, deadlineMs - this.clock.nowMs());
          if (remainingTimeMs === 0) {
            arbiter.record({
              cause: 'total_timeout',
              atMs: deadlineMs,
              error: safeError('TOTAL_EXECUTION_TIMEOUT'),
            });
            controller.abort();
            primary = choosePrimary();
            break;
          }

          record.startedAtMs = this.clock.nowMs();
          this.transitionStep(record, steps, 'running', executionId, progress);
          let stepError: SafeExecutionError | null = null;
          try {
            if (record.step.type === 'approval') {
              const coordinator = this.dependencies.approvalCoordinator;
              if (coordinator === undefined) {
                throw new SafeExecutionException(
                  'APPROVAL_COORDINATOR_UNAVAILABLE',
                );
              }
              const binding = requireApprovalBinding(
                prepared.request.workflow,
                record.step.id,
              );
              this.transitionStep(
                record,
                steps,
                'waiting_for_approval',
                executionId,
                progress,
              );
              transitionRun('waiting_for_approval');
              const expiresAtMs =
                this.clock.nowMs() +
                Math.min(record.step.timeoutMs, remainingTimeMs);
              progress.emit({
                kind: 'approval_status_changed',
                executionId,
                timestamp: timestampFromMs(this.clock.nowMs()),
                approvalStepId: binding.approvalStepId,
                gatedStepId: binding.gatedStepId,
                riskLevel: binding.riskLevel,
                status: 'PENDING',
              });
              const approval = ApprovalCoordinatorResultSchema.parse(
                await coordinator.awaitApproval(
                  {
                    executionId,
                    workflowId: prepared.request.workflow.workflowId,
                    workflowVersion: prepared.request.workflow.version,
                    approvalStepId: binding.approvalStepId,
                    gatedStepId: binding.gatedStepId,
                    riskLevel: binding.riskLevel,
                    expiresAt: timestampFromMs(expiresAtMs),
                  },
                  controller.signal,
                ),
              );
              const approvalStatus: Exclude<ApprovalRequestStatus, 'PENDING'> =
                (
                  {
                    approved: 'APPROVED',
                    rejected: 'REJECTED',
                    expired: 'EXPIRED',
                    cancelled: 'CANCELLED',
                    invalidated: 'INVALIDATED',
                  } as const
                )[approval.decision];
              progress.emit({
                kind: 'approval_status_changed',
                executionId,
                timestamp: approval.decidedAt,
                approvalStepId: binding.approvalStepId,
                gatedStepId: binding.gatedStepId,
                riskLevel: binding.riskLevel,
                status: approvalStatus,
                decision: approval.decision,
              });
              recordDeadlineIfElapsed();
              primary = choosePrimary();
              if (approval.decision === 'approved' && primary === null) {
                transitionRun('running');
                record.finishedAtMs = this.clock.nowMs();
                this.transitionStep(
                  record,
                  steps,
                  'succeeded',
                  executionId,
                  progress,
                );
                continue;
              }
              if (approval.decision === 'rejected') {
                arbiter.record({
                  cause: 'approval_rejected',
                  atMs: this.clock.nowMs(),
                  error: safeError('APPROVAL_REJECTED'),
                  stepId: record.step.id,
                });
              } else if (approval.decision === 'expired') {
                arbiter.record({
                  cause: 'approval_expired',
                  atMs: this.clock.nowMs(),
                  error: safeError('APPROVAL_EXPIRED'),
                  stepId: record.step.id,
                });
              } else if (approval.decision === 'invalidated') {
                arbiter.record({
                  cause: 'approval_invalidated',
                  atMs: this.clock.nowMs(),
                  error: safeError('APPROVAL_INVALIDATED'),
                  stepId: record.step.id,
                });
              } else if (approval.decision === 'cancelled') {
                arbiter.record({
                  cause: 'run_cancelled',
                  atMs: this.clock.nowMs(),
                  error: safeError('EXECUTION_CANCELLED'),
                  stepId: record.step.id,
                });
              }
            } else {
              const output = await this.adapter.executeStep({
                executionId,
                valueResolver: executionValueResolver,
                allowedOrigins: prepared.allowedOrigins,
                totalTimeoutMs: prepared.request.options.totalTimeoutMs,
                remainingTimeMs,
                effectiveTimeoutMs: Math.min(
                  prepared.request.options.stepTimeoutMs,
                  remainingTimeMs,
                ),
                signal: controller.signal,
                step: record.step,
              });
              if (output?.verification !== undefined) {
                record.verification = output.verification;
              }
              if (output?.producedOutput !== undefined) {
                if (record.step.type !== 'extract') {
                  throw new SafeExecutionException('INVALID_WORKFLOW');
                }
                const expectedType = outputTypeForExtractStep(record.step);
                if (
                  output.producedOutput.outputName !== record.step.outputName ||
                  output.producedOutput.outputType !== expectedType
                ) {
                  throw new SafeExecutionException('OUTPUT_TYPE_MISMATCH');
                }
                outputStore.set(
                  output.producedOutput.outputName,
                  output.producedOutput.outputType,
                  output.producedOutput.value,
                );
                progress.emit({
                  kind: 'output_produced',
                  executionId,
                  timestamp: timestampFromMs(this.clock.nowMs()),
                  producerStepId: record.step.id,
                  outputName: record.step.outputName,
                  outputType: output.producedOutput.outputType,
                });
              } else if (record.step.type === 'extract') {
                throw new SafeExecutionException(
                  'EXTRACTION_VALUE_UNAVAILABLE',
                );
              }
            }
          } catch (error: unknown) {
            stepError = toSafeError(
              error,
              record.step.type === 'approval'
                ? 'APPROVAL_REQUEST_FAILED'
                : 'ACTION_FAILED',
            );
            if (error instanceof SafeExecutionException) {
              if (error.verification !== undefined) {
                record.verification = error.verification;
              }
            }
          }
          recordDeadlineIfElapsed();
          if (stepError !== null) {
            const isStepTimeout = TIMEOUT_ERROR_CODES.has(stepError.code);
            arbiter.record({
              cause: isStepTimeout ? 'step_timeout' : 'step_failed',
              atMs: this.clock.nowMs(),
              error: stepError,
              stepId: record.step.id,
            });
          }
          primary = choosePrimary();
          record.finishedAtMs = this.clock.nowMs();
          if (primary !== null) {
            record.error = primary.error;
            const status =
              primary.cause === 'run_cancelled' ||
              primary.cause === 'approval_rejected'
                ? 'cancelled'
                : primary.cause === 'total_timeout' ||
                    primary.cause === 'step_timeout' ||
                    primary.cause === 'approval_expired'
                  ? 'timed_out'
                  : primary.cause === 'approval_invalidated'
                    ? 'interrupted'
                    : 'failed';
            this.transitionStep(
              record,
              steps,
              status,
              executionId,
              progress,
              primary.error,
            );
            break;
          }
          this.transitionStep(
            record,
            steps,
            'succeeded',
            executionId,
            progress,
          );
        }
      }

      if (primary !== null) {
        this.skipPending(
          records,
          steps,
          skipReasonFor(primary.cause),
          executionId,
          progress,
        );
        if (
          primary.cause === 'run_cancelled' ||
          primary.cause === 'approval_rejected'
        ) {
          transitionRun('cancelling', primary.error);
        } else {
          transitionRun(terminalStatusFor(primary.cause), primary.error);
        }
      }
    } finally {
      timer.cancel();
      externalSignal?.removeEventListener('abort', onExternalAbort);
      if (adapterStartupAttempted) {
        try {
          cleanupError = await this.adapter.stop({
            executionId,
            terminationCause: primary?.cause ?? 'completed',
          });
        } catch {
          cleanupError = safeError('RESOURCE_CLEANUP_FAILED');
        }
      }
      outputSummaries = outputStore.summaries();
      outputStore.clear();
    }

    if (cleanupError !== null) {
      progress.emit({
        kind: 'warning',
        executionId,
        timestamp: timestampFromMs(this.clock.nowMs()),
        warningCode: 'RESOURCE_CLEANUP_FAILED',
      });
    }

    let status: WorkflowExecutionResult['status'];
    let cause: TerminationCause;
    let resultError: SafeExecutionError | undefined;
    if (primary !== null) {
      status = terminalStatusFor(primary.cause);
      cause = primary.cause;
      resultError = primary.error;
      if (
        primary.cause === 'run_cancelled' ||
        primary.cause === 'approval_rejected'
      ) {
        transitionRun('cancelled', primary.error);
      }
    } else if (cleanupError !== null) {
      status = 'failed';
      cause = 'cleanup_failed';
      resultError = cleanupError;
      transitionRun('failed', cleanupError);
    } else {
      status = 'succeeded';
      cause = 'completed';
      transitionRun('succeeded');
    }

    const warnings = [...progress.warnings()];
    if (cleanupError !== null) {
      warnings.push({
        code: 'RESOURCE_CLEANUP_FAILED',
        message: 'Execution resources could not be closed cleanly.',
      });
    }

    if (
      run.state !== 'succeeded' &&
      run.state !== 'failed' &&
      run.state !== 'cancelled' &&
      run.state !== 'timed_out' &&
      run.state !== 'interrupted'
    ) {
      throw new Error('The workflow engine did not reach a terminal state.');
    }

    return buildWorkflowExecutionResult({
      executionId,
      workflow: prepared.request.workflow,
      status,
      startedAtMs,
      finishedAtMs: this.clock.nowMs(),
      terminationCause: cause,
      records,
      warnings,
      ...(resultError === undefined ? {} : { error: resultError }),
      ...(primary?.stepId === undefined
        ? {}
        : { failedStepId: primary.stepId }),
      outputs: outputSummaries,
    });
  }
}
