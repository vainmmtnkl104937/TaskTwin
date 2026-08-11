import type {
  RunnerRolloutAssignmentStatus,
  RunnerRolloutStageStatus,
  RunnerRolloutStatus,
} from './contracts.js';
import { RunnerRolloutError } from './errors.js';

const rolloutTransitions: Readonly<
  Record<RunnerRolloutStatus, readonly RunnerRolloutStatus[]>
> = {
  draft: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};

const stageTransitions: Readonly<
  Record<RunnerRolloutStageStatus, readonly RunnerRolloutStageStatus[]>
> = {
  pending: ['active', 'cancelled'],
  active: ['completed', 'failed_review', 'cancelled'],
  completed: [],
  failed_review: ['cancelled'],
  cancelled: [],
};

const assignmentTransitions: Readonly<
  Record<
    RunnerRolloutAssignmentStatus,
    readonly RunnerRolloutAssignmentStatus[]
  >
> = {
  pending: ['target_assigned', 'cancelled'],
  target_assigned: ['converged', 'failed', 'cancelled'],
  converged: ['rolled_back'],
  rolled_back: [],
  failed: [],
  cancelled: [],
};

function assertTransition<T extends string>(
  current: T,
  next: T,
  transitions: Readonly<Record<T, readonly T[]>>,
): void {
  if (current === next) return;
  if (!transitions[current].includes(next)) {
    throw new RunnerRolloutError(
      'invalid_state_transition',
      `State cannot transition from ${current} to ${next}.`,
    );
  }
}

export function assertRolloutTransition(
  current: RunnerRolloutStatus,
  next: RunnerRolloutStatus,
): void {
  assertTransition(current, next, rolloutTransitions);
}

export function assertStageTransition(
  current: RunnerRolloutStageStatus,
  next: RunnerRolloutStageStatus,
): void {
  assertTransition(current, next, stageTransitions);
}

export function assertAssignmentTransition(
  current: RunnerRolloutAssignmentStatus,
  next: RunnerRolloutAssignmentStatus,
): void {
  assertTransition(current, next, assignmentTransitions);
}
