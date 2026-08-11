import type {
  RunnerReleaseCatalogStatus,
  RunnerReleaseStatusReason,
} from './contracts.js';
import { RunnerRolloutError } from './errors.js';

const transitions: Readonly<
  Record<RunnerReleaseCatalogStatus, readonly RunnerReleaseCatalogStatus[]>
> = {
  available: ['deprecated', 'blocked'],
  deprecated: ['blocked'],
  blocked: [],
};

const reasonsByStatus: Readonly<
  Record<
    Exclude<RunnerReleaseCatalogStatus, 'available'>,
    readonly RunnerReleaseStatusReason[]
  >
> = {
  deprecated: ['superseded', 'end_of_support'],
  blocked: [
    'security_issue',
    'integrity_issue',
    'compatibility_issue',
    'operational_issue',
  ],
};

export function assertReleaseStatusTransition(input: {
  current: RunnerReleaseCatalogStatus;
  next: Exclude<RunnerReleaseCatalogStatus, 'available'>;
  reason: RunnerReleaseStatusReason;
}): void {
  if (!transitions[input.current].includes(input.next)) {
    throw new RunnerRolloutError(
      'invalid_state_transition',
      `Release status cannot transition from ${input.current} to ${input.next}.`,
    );
  }
  if (!reasonsByStatus[input.next].includes(input.reason)) {
    throw new RunnerRolloutError(
      'invalid_state_transition',
      `Reason ${input.reason} is not valid for ${input.next}.`,
    );
  }
}

export function assertReleaseCanTargetRollout(
  status: RunnerReleaseCatalogStatus,
): void {
  if (status !== 'available') {
    throw new RunnerRolloutError(
      'release_not_available',
      'Only an available trusted release can target a rollout.',
    );
  }
}
