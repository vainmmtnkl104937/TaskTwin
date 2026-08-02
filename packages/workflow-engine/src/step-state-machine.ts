import type {
  WorkflowEngineStepStatus,
  WorkflowStepType,
} from './contracts.js';
import { SafeExecutionException } from './errors.js';

const TRANSITIONS = {
  pending: ['running', 'skipped'],
  running: [
    'waiting_for_approval',
    'waiting_for_repair',
    'succeeded',
    'failed',
    'cancelled',
    'timed_out',
    'interrupted',
  ],
  waiting_for_approval: [
    'succeeded',
    'failed',
    'cancelled',
    'timed_out',
    'interrupted',
  ],
  waiting_for_repair: [
    'running',
    'failed',
    'cancelled',
    'timed_out',
    'interrupted',
  ],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  skipped: [],
  interrupted: [],
} as const satisfies Record<
  WorkflowEngineStepStatus,
  readonly WorkflowEngineStepStatus[]
>;

export interface StepStateDescriptor {
  stepId: string;
  stepType: WorkflowStepType;
}

export class StepStateMachine {
  private readonly states: Map<string, WorkflowEngineStepStatus>;
  private runningStepId: string | null = null;

  constructor(readonly steps: readonly StepStateDescriptor[]) {
    this.states = new Map(steps.map((step) => [step.stepId, 'pending']));
  }

  stateOf(stepId: string): WorkflowEngineStepStatus {
    const state = this.states.get(stepId);
    if (state === undefined) {
      throw new SafeExecutionException('INVALID_STEP_TRANSITION');
    }
    return state;
  }

  transition(stepId: string, next: WorkflowEngineStepStatus): void {
    const current = this.stateOf(stepId);
    const allowed = TRANSITIONS[current] as readonly WorkflowEngineStepStatus[];
    if (!allowed.includes(next)) {
      throw new SafeExecutionException('INVALID_STEP_TRANSITION');
    }
    if (
      next === 'running' &&
      this.runningStepId !== null &&
      this.runningStepId !== stepId
    ) {
      throw new SafeExecutionException('INVALID_STEP_TRANSITION');
    }
    if (next === 'running') {
      this.runningStepId = stepId;
    } else if (current === 'running') {
      this.runningStepId = null;
    }
    this.states.set(stepId, next);
  }
}

export function validStepTransitions(): Readonly<
  Record<WorkflowEngineStepStatus, readonly WorkflowEngineStepStatus[]>
> {
  return TRANSITIONS;
}
