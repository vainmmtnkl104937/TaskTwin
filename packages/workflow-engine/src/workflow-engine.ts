import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import {
  defineWorkflowOutputs,
  outputTypeForExtractStep,
  type SafeWorkflowOutputSummary,
  type WorkflowOutputDefinition,
} from '@tasktwin/workflow-extraction';
import {
  MAX_REPAIR_TIMEOUT_MS,
  RecoveryCoordinatorResultSchema,
  decideRetry,
  isApprovalGatedStep,
  type ExecutionEffectCertainty,
  type RetryTrigger,
  type SafeStepAttempt,
} from '@tasktwin/workflow-recovery';

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
import type { WorkflowRecoveryCoordinator } from './recovery-coordinator.js';
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
  recoveryCoordinator?: WorkflowRecoveryCoordinator;
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
    case 'repair_aborted':
      return 'repair_aborted';
    case 'repair_expired':
      return 'repair_expired';
    case 'repair_invalidated':
      return 'repair_invalidated';
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
    case 'repair_aborted':
      return 'cancelled';
    case 'approval_expired':
    case 'repair_expired':
      return 'timed_out';
    case 'approval_invalidated':
    case 'repair_invalidated':
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
      this.dependencies.recoveryCoordinator !== undefined,
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

    const beginAttempt = (
      record: ExecutionStepRecord,
      trigger: RetryTrigger,
      repairRequestId?: string,
    ): SafeStepAttempt => {
      const attempt: SafeStepAttempt = {
        attemptNumber: (record.attempts?.length ?? 0) + 1,
        trigger,
        status: 'running',
        startedAt: timestampFromMs(this.clock.nowMs()),
        effectCertainty: 'unknown',
        ...(repairRequestId === undefined ? {} : { repairRequestId }),
      };
      record.attempts ??= [];
      record.attempts.push(attempt);
      progress.emit({
        kind: 'step_attempt_status_changed',
        executionId,
        timestamp: attempt.startedAt,
        stepId: record.step.id,
        attemptNumber: attempt.attemptNumber,
        trigger,
        status: 'running',
        effectCertainty: 'unknown',
        retryAllowed: false,
      });
      return attempt;
    };

    const finishAttempt = (
      record: ExecutionStepRecord,
      attempt: SafeStepAttempt,
      status: Exclude<SafeStepAttempt['status'], 'running'>,
      effectCertainty: ExecutionEffectCertainty,
      retryAllowed: boolean,
      error?: SafeExecutionError,
    ): void => {
      const finishedAt = timestampFromMs(this.clock.nowMs());
      attempt.status = status;
      attempt.finishedAt = finishedAt;
      attempt.durationMs = Math.max(
        0,
        Date.parse(finishedAt) - Date.parse(attempt.startedAt),
      );
      attempt.effectCertainty = effectCertainty;
      if (error !== undefined) attempt.errorCode = error.code;
      progress.emit({
        kind: 'step_attempt_status_changed',
        executionId,
        timestamp: finishedAt,
        stepId: record.step.id,
        attemptNumber: attempt.attemptNumber,
        trigger: attempt.trigger,
        status,
        ...(error === undefined ? {} : { errorCode: error.code }),
        effectCertainty,
        retryAllowed,
      });
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
        stepLoop: for (const record of records) {
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
          if (record.step.type === 'approval') {
            const attempt = beginAttempt(record, 'initial');
            try {
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
                finishAttempt(record, attempt, 'succeeded', 'completed', false);
                continue stepLoop;
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
              if (approval.decision !== 'approved') {
                const approvalError =
                  approval.decision === 'rejected'
                    ? safeError('APPROVAL_REJECTED')
                    : approval.decision === 'expired'
                      ? safeError('APPROVAL_EXPIRED')
                      : approval.decision === 'invalidated'
                        ? safeError('APPROVAL_INVALIDATED')
                        : safeError('EXECUTION_CANCELLED');
                finishAttempt(
                  record,
                  attempt,
                  approval.decision === 'expired'
                    ? 'timed_out'
                    : approval.decision === 'invalidated'
                      ? 'interrupted'
                      : 'cancelled',
                  'read_only',
                  false,
                  approvalError,
                );
              }
            } catch (error: unknown) {
              stepError = toSafeError(error, 'APPROVAL_REQUEST_FAILED');
              finishAttempt(
                record,
                attempt,
                stepError.code === 'EXECUTION_CANCELLED'
                  ? 'cancelled'
                  : TIMEOUT_ERROR_CODES.has(stepError.code)
                    ? 'timed_out'
                    : 'failed',
                'unknown',
                false,
                stepError,
              );
            }
          } else {
            let trigger: RetryTrigger = 'initial';
            let repairRequestId: string | undefined;
            while (stepError === null) {
              recordDeadlineIfElapsed();
              primary = choosePrimary();
              if (primary !== null) break;
              const attempt = beginAttempt(record, trigger, repairRequestId);
              const attemptRemainingMs = Math.max(
                0,
                deadlineMs - this.clock.nowMs(),
              );
              let attemptError: SafeExecutionError | null = null;
              let effectCertainty: ExecutionEffectCertainty = 'unknown';
              try {
                const output = await this.adapter.executeStep({
                  executionId,
                  valueResolver: executionValueResolver,
                  allowedOrigins: prepared.allowedOrigins,
                  totalTimeoutMs: prepared.request.options.totalTimeoutMs,
                  remainingTimeMs: attemptRemainingMs,
                  effectiveTimeoutMs: Math.min(
                    prepared.request.options.stepTimeoutMs,
                    attemptRemainingMs,
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
                    output.producedOutput.outputName !==
                      record.step.outputName ||
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
                    undefined,
                    'read_only',
                  );
                }
              } catch (error: unknown) {
                attemptError = toSafeError(error, 'ACTION_FAILED');
                if (error instanceof SafeExecutionException) {
                  effectCertainty = error.effectCertainty ?? 'unknown';
                  if (error.verification !== undefined) {
                    record.verification = error.verification;
                  }
                }
              }
              if (attemptError === null) {
                finishAttempt(record, attempt, 'succeeded', 'completed', false);
                break;
              }
              const automaticRetryCount =
                record.attempts?.filter(
                  (item) => item.trigger === 'automatic_retry',
                ).length ?? 0;
              const manualRetryCount =
                record.attempts?.filter(
                  (item) => item.trigger === 'manual_retry',
                ).length ?? 0;
              const decision = decideRetry({
                stepType: record.step.type,
                errorCode: attemptError.code,
                effectCertainty,
                recoveryMode: prepared.request.options.recoveryMode,
                automaticRetryCount,
                manualRetryCount,
                totalAttemptCount: record.attempts?.length ?? 1,
                approvalGated: isApprovalGatedStep(
                  prepared.request.workflow,
                  record.step.id,
                ),
              });
              finishAttempt(
                record,
                attempt,
                attemptError.code === 'EXECUTION_CANCELLED'
                  ? 'cancelled'
                  : TIMEOUT_ERROR_CODES.has(attemptError.code)
                    ? 'timed_out'
                    : 'failed',
                effectCertainty,
                decision.retryAllowed,
                attemptError,
              );
              if (decision.disposition === 'automatic_retry') {
                trigger = 'automatic_retry';
                repairRequestId = undefined;
                continue;
              }
              if (decision.disposition === 'manual_repair') {
                const coordinator = this.dependencies.recoveryCoordinator;
                if (coordinator === undefined) {
                  stepError = safeError('RECOVERY_COORDINATOR_UNAVAILABLE');
                  break;
                }
                this.transitionStep(
                  record,
                  steps,
                  'waiting_for_repair',
                  executionId,
                  progress,
                );
                transitionRun('waiting_for_repair');
                const expiresAt = timestampFromMs(
                  this.clock.nowMs() +
                    Math.min(
                      MAX_REPAIR_TIMEOUT_MS,
                      Math.max(1, deadlineMs - this.clock.nowMs()),
                    ),
                );
                let repair;
                try {
                  repair = RecoveryCoordinatorResultSchema.parse(
                    await coordinator.awaitRepair(
                      {
                        executionId,
                        workflowId: prepared.request.workflow.workflowId,
                        workflowVersion: prepared.request.workflow.version,
                        stepId: record.step.id,
                        stepIndex: prepared.request.workflow.steps.findIndex(
                          (step) => step.id === record.step.id,
                        ),
                        stepType: record.step.type,
                        attemptNumber: attempt.attemptNumber,
                        safeErrorCode: attemptError.code,
                        effectCertainty,
                        expiresAt,
                      },
                      controller.signal,
                    ),
                  );
                } catch {
                  stepError = safeError('RECOVERY_REQUEST_FAILED');
                  break;
                }
                const repairStatus = {
                  retry: 'RETRY_APPROVED',
                  abort: 'ABORTED',
                  expired: 'EXPIRED',
                  cancelled: 'CANCELLED',
                  invalidated: 'INVALIDATED',
                } as const;
                progress.emit({
                  kind: 'repair_status_changed',
                  executionId,
                  timestamp: repair.decidedAt,
                  stepId: record.step.id,
                  attemptNumber: attempt.attemptNumber,
                  status: repairStatus[repair.decision],
                  errorCode: attemptError.code,
                  effectCertainty,
                  retryAllowed: repair.decision === 'retry',
                });
                recordDeadlineIfElapsed();
                primary = choosePrimary();
                if (repair.decision === 'retry' && primary === null) {
                  transitionRun('running');
                  this.transitionStep(
                    record,
                    steps,
                    'running',
                    executionId,
                    progress,
                  );
                  trigger = 'manual_retry';
                  repairRequestId = repair.repairRequestId;
                  continue;
                }
                const termination = {
                  abort: {
                    cause: 'repair_aborted' as const,
                    error: safeError('RECOVERY_ABORTED'),
                  },
                  expired: {
                    cause: 'repair_expired' as const,
                    error: safeError('RECOVERY_EXPIRED'),
                  },
                  cancelled: {
                    cause: 'run_cancelled' as const,
                    error: safeError('EXECUTION_CANCELLED'),
                  },
                  invalidated: {
                    cause: 'repair_invalidated' as const,
                    error: safeError('RECOVERY_INVALIDATED'),
                  },
                };
                if (repair.decision !== 'retry') {
                  const selected = termination[repair.decision];
                  arbiter.record({
                    ...selected,
                    atMs: this.clock.nowMs(),
                    stepId: record.step.id,
                  });
                }
                break;
              }
              stepError =
                decision.disposition === 'new_run_required'
                  ? safeError('APPROVAL_GATED_RETRY_REQUIRES_NEW_RUN')
                  : attemptError;
              break;
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
              primary.cause === 'approval_rejected' ||
              primary.cause === 'repair_aborted'
                ? 'cancelled'
                : primary.cause === 'total_timeout' ||
                    primary.cause === 'step_timeout' ||
                    primary.cause === 'approval_expired' ||
                    primary.cause === 'repair_expired'
                  ? 'timed_out'
                  : primary.cause === 'approval_invalidated' ||
                      primary.cause === 'repair_invalidated'
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
          primary.cause === 'approval_rejected' ||
          primary.cause === 'repair_aborted'
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
        primary.cause === 'approval_rejected' ||
        primary.cause === 'repair_aborted'
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
