import type { RunnerServiceLifecycleState } from './contracts.js';
import { RunnerServiceRuntimeError } from './errors.js';

const TRANSITIONS: Readonly<Record<RunnerServiceLifecycleState, readonly RunnerServiceLifecycleState[]>> = {
  created: ['initializing', 'stopped'],
  initializing: ['connecting', 'failed', 'stopping', 'revoked'],
  connecting: ['ready', 'failed', 'stopping', 'revoked'],
  ready: ['connecting', 'draining', 'failed', 'revoked'],
  draining: ['stopping', 'failed', 'revoked'],
  stopping: ['stopped', 'failed'],
  stopped: ['initializing'],
  failed: ['initializing', 'stopping', 'stopped'],
  revoked: ['stopping', 'stopped'],
};

export function canTransitionRunnerLifecycle(
  from: RunnerServiceLifecycleState,
  to: RunnerServiceLifecycleState,
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertRunnerLifecycleTransition(
  from: RunnerServiceLifecycleState,
  to: RunnerServiceLifecycleState,
): void {
  if (!canTransitionRunnerLifecycle(from, to)) {
    throw new RunnerServiceRuntimeError('RUNNER_RUNTIME_TRANSITION_INVALID');
  }
}
