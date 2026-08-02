import type { StepAttemptStatus } from './contracts.js';

const TRANSITIONS = {
  running: ['succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted'],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  interrupted: [],
} as const satisfies Record<StepAttemptStatus, readonly StepAttemptStatus[]>;

export function canTransitionAttempt(
  current: StepAttemptStatus,
  next: StepAttemptStatus,
): boolean {
  return (TRANSITIONS[current] as readonly StepAttemptStatus[]).includes(next);
}
