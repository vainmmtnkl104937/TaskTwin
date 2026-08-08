export const RUNNER_RECONNECT_DELAYS_MS = [
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
  30_000,
  60_000,
] as const;

export type RunnerConnectionFailureKind = 'retryable' | 'permanent';

export function reconnectDelayMilliseconds(failureCount: number): number {
  if (!Number.isInteger(failureCount) || failureCount < 1) {
    return RUNNER_RECONNECT_DELAYS_MS[0];
  }
  return RUNNER_RECONNECT_DELAYS_MS[
    Math.min(failureCount - 1, RUNNER_RECONNECT_DELAYS_MS.length - 1)
  ]!;
}

export function classifyHttpConnectionFailure(status: number | null): RunnerConnectionFailureKind {
  if (status === null || status === 408 || status === 425 || status === 429 || status >= 500) {
    return 'retryable';
  }
  return 'permanent';
}
