import {
  RunnerUpdateStateSchema,
  type RunnerUpdateState,
} from './contracts.js';
import { RunnerUpdateError } from './errors.js';

const ALLOWED_RUNNER_UPDATE_TRANSITIONS: Readonly<
  Record<RunnerUpdateState, readonly RunnerUpdateState[]>
> = {
  idle: ['preparing'],
  preparing: ['draining', 'failed_before_switch', 'manual_recovery_required'],
  draining: [
    'staging',
    'rolling_back',
    'failed_before_switch',
    'manual_recovery_required',
  ],
  staging: [
    'ready_to_switch',
    'failed_before_switch',
    'manual_recovery_required',
  ],
  ready_to_switch: [
    'switching',
    'failed_before_switch',
    'manual_recovery_required',
  ],
  switching: [
    'starting_target',
    'rolling_back',
    'failed_before_switch',
    'manual_recovery_required',
  ],
  starting_target: [
    'verifying_target',
    'rolling_back',
    'manual_recovery_required',
  ],
  verifying_target: ['succeeded', 'rolling_back', 'manual_recovery_required'],
  succeeded: ['idle'],
  failed_before_switch: ['idle'],
  rolling_back: ['rolled_back', 'manual_recovery_required'],
  rolled_back: ['idle'],
  manual_recovery_required: [],
};

export function canTransitionRunnerUpdateState(
  from: RunnerUpdateState,
  to: RunnerUpdateState,
): boolean {
  const parsedFrom = RunnerUpdateStateSchema.parse(from);
  const parsedTo = RunnerUpdateStateSchema.parse(to);
  return ALLOWED_RUNNER_UPDATE_TRANSITIONS[parsedFrom].includes(parsedTo);
}

export function assertRunnerUpdateStateTransition(
  from: RunnerUpdateState,
  to: RunnerUpdateState,
): void {
  if (!canTransitionRunnerUpdateState(from, to)) {
    throw new RunnerUpdateError(
      'update_state_transition_invalid',
      `Runner update cannot transition from ${from} to ${to}.`,
    );
  }
}

export const assertCanTransitionRunnerUpdateState =
  assertRunnerUpdateStateTransition;
