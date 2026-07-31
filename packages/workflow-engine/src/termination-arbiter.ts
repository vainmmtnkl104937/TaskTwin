import type { SafeExecutionError, TerminationCause } from './contracts.js';

export type RacingTerminationCause = Extract<
  TerminationCause,
  | 'adapter_start_failed'
  | 'step_failed'
  | 'step_timeout'
  | 'run_cancelled'
  | 'total_timeout'
>;

export interface TerminationCandidate {
  cause: RacingTerminationCause;
  atMs: number;
  error: SafeExecutionError;
  stepId?: string;
}

const TIE_PRIORITY: Readonly<Record<RacingTerminationCause, number>> = {
  total_timeout: 0,
  run_cancelled: 1,
  adapter_start_failed: 2,
  step_timeout: 2,
  step_failed: 2,
};

export class TerminationArbiter {
  private readonly candidates: Array<
    TerminationCandidate & { sequence: number }
  > = [];
  private locked: TerminationCandidate | null = null;
  private sequence = 0;

  record(candidate: TerminationCandidate): void {
    if (this.locked !== null) {
      return;
    }
    this.candidates.push({ ...candidate, sequence: this.sequence });
    this.sequence += 1;
  }

  lockWinner(): TerminationCandidate | null {
    if (this.locked !== null) {
      return this.locked;
    }
    const winner = [...this.candidates].sort((left, right) => {
      if (left.atMs !== right.atMs) {
        return left.atMs - right.atMs;
      }
      const priority = TIE_PRIORITY[left.cause] - TIE_PRIORITY[right.cause];
      return priority !== 0 ? priority : left.sequence - right.sequence;
    })[0];
    if (winner === undefined) {
      return null;
    }
    this.locked = {
      cause: winner.cause,
      atMs: winner.atMs,
      error: winner.error,
      ...(winner.stepId === undefined ? {} : { stepId: winner.stepId }),
    };
    return this.locked;
  }
}
