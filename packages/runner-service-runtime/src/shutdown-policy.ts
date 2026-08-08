export const DEFAULT_RUNNER_DRAIN_TIMEOUT_MS = 60_000;

export type RunnerDrainDecision = 'wait' | 'complete' | 'cancel';

export function decideRunnerDrain(input: {
  activeRun: boolean;
  elapsedMilliseconds: number;
  timeoutMilliseconds?: number;
}): RunnerDrainDecision {
  if (!input.activeRun) return 'complete';
  const timeout = input.timeoutMilliseconds ?? DEFAULT_RUNNER_DRAIN_TIMEOUT_MS;
  return input.elapsedMilliseconds >= timeout ? 'cancel' : 'wait';
}
