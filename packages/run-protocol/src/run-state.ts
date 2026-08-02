import type { PersistedRunStepStatus, WorkflowRunStatus } from './contracts.js';

const RUN_TRANSITIONS = {
  QUEUED: ['CLAIMED', 'CANCELLED'],
  CLAIMED: [
    'RUNNING',
    'WAITING_FOR_APPROVAL',
    'WAITING_FOR_REPAIR',
    'CANCEL_REQUESTED',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'INTERRUPTED',
  ],
  RUNNING: [
    'WAITING_FOR_APPROVAL',
    'WAITING_FOR_REPAIR',
    'CANCEL_REQUESTED',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'INTERRUPTED',
  ],
  WAITING_FOR_APPROVAL: [
    'RUNNING',
    'CANCEL_REQUESTED',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'INTERRUPTED',
  ],
  WAITING_FOR_REPAIR: [
    'RUNNING',
    'CANCEL_REQUESTED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'INTERRUPTED',
  ],
  CANCEL_REQUESTED: [
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'INTERRUPTED',
  ],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
  INTERRUPTED: [],
} as const satisfies Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>;

const STEP_TRANSITIONS = {
  PENDING: [
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'SKIPPED',
    'INTERRUPTED',
  ],
  RUNNING: [
    'WAITING_FOR_APPROVAL',
    'WAITING_FOR_REPAIR',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'INTERRUPTED',
  ],
  WAITING_FOR_APPROVAL: [
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'INTERRUPTED',
  ],
  WAITING_FOR_REPAIR: [
    'RUNNING',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'INTERRUPTED',
  ],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
  SKIPPED: [],
  INTERRUPTED: [],
} as const satisfies Record<
  PersistedRunStepStatus,
  readonly PersistedRunStepStatus[]
>;

export function canTransitionWorkflowRun(
  current: WorkflowRunStatus,
  next: WorkflowRunStatus,
): boolean {
  return (RUN_TRANSITIONS[current] as readonly WorkflowRunStatus[]).includes(
    next,
  );
}

export function canTransitionRunStep(
  current: PersistedRunStepStatus,
  next: PersistedRunStepStatus,
): boolean {
  return (
    STEP_TRANSITIONS[current] as readonly PersistedRunStepStatus[]
  ).includes(next);
}

export function isTerminalWorkflowRunStatus(
  status: WorkflowRunStatus,
): boolean {
  return RUN_TRANSITIONS[status].length === 0;
}
