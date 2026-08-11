import type { RunnerRolloutAssignmentStatus } from './contracts.js';

export type AssignmentObservation =
  | { outcome: 'unchanged'; assignmentStatus: RunnerRolloutAssignmentStatus }
  | { outcome: 'converged'; assignmentStatus: 'converged' }
  | { outcome: 'rolled_back'; assignmentStatus: 'rolled_back' }
  | { outcome: 'failed'; assignmentStatus: 'failed' };

export function observeAssignmentVersion(input: {
  assignmentStatus: RunnerRolloutAssignmentStatus;
  targetVersion: string;
  baselineVersion: string | null;
  actualVersion: string;
}): AssignmentObservation {
  if (input.assignmentStatus === 'target_assigned') {
    if (input.actualVersion === input.targetVersion) {
      return { outcome: 'converged', assignmentStatus: 'converged' };
    }
    return { outcome: 'unchanged', assignmentStatus: 'target_assigned' };
  }
  if (input.assignmentStatus === 'converged') {
    if (input.actualVersion === input.targetVersion) {
      return { outcome: 'unchanged', assignmentStatus: 'converged' };
    }
    if (
      input.baselineVersion !== null &&
      input.actualVersion === input.baselineVersion
    ) {
      return { outcome: 'rolled_back', assignmentStatus: 'rolled_back' };
    }
    return { outcome: 'failed', assignmentStatus: 'failed' };
  }
  return { outcome: 'unchanged', assignmentStatus: input.assignmentStatus };
}

export function stageHasConverged(
  assignmentStatuses: readonly RunnerRolloutAssignmentStatus[],
): boolean {
  return (
    assignmentStatuses.length > 0 &&
    assignmentStatuses.every((status) => status === 'converged')
  );
}
