import type { WorkflowEngineRunStatus } from './contracts.js';
import { SafeExecutionException } from './errors.js';

const TRANSITIONS = {
  pending: ['validating', 'cancelling'],
  validating: ['starting', 'cancelling', 'failed'],
  starting: ['running', 'cancelling', 'failed', 'timed_out'],
  running: ['cancelling', 'succeeded', 'failed', 'timed_out'],
  cancelling: ['cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
} as const satisfies Record<
  WorkflowEngineRunStatus,
  readonly WorkflowEngineRunStatus[]
>;

export class RunStateMachine {
  private current: WorkflowEngineRunStatus = 'pending';

  get state(): WorkflowEngineRunStatus {
    return this.current;
  }

  transition(next: WorkflowEngineRunStatus): void {
    const allowed = TRANSITIONS[
      this.current
    ] as readonly WorkflowEngineRunStatus[];
    if (!allowed.includes(next)) {
      throw new SafeExecutionException('INVALID_RUN_TRANSITION');
    }
    this.current = next;
  }
}

export function validRunTransitions(): Readonly<
  Record<WorkflowEngineRunStatus, readonly WorkflowEngineRunStatus[]>
> {
  return TRANSITIONS;
}
