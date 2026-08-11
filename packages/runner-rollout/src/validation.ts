import type {
  ReleaseTarget,
  RolloutPlan,
  RunnerRolloutStageStatus,
} from './contracts.js';
import { ReleaseTargetSchema, RolloutPlanSchema } from './contracts.js';
import { RunnerRolloutError } from './errors.js';
import { assertReleaseCanTargetRollout } from './release-status.js';

export function validateRolloutPlan(unparsedPlan: RolloutPlan): RolloutPlan {
  const plan = RolloutPlanSchema.parse(unparsedPlan);
  const seen = new Set<string>();
  plan.stages.forEach((stage, index) => {
    if (stage.stageNumber !== index + 1) {
      throw new RunnerRolloutError(
        'stage_out_of_order',
        'Rollout stages must be contiguous and begin at one.',
      );
    }
    for (const runnerDeviceId of stage.runnerDeviceIds) {
      if (seen.has(runnerDeviceId)) {
        throw new RunnerRolloutError(
          'runner_duplicate_assignment',
          'A Runner cannot appear in more than one rollout stage.',
        );
      }
      seen.add(runnerDeviceId);
    }
  });
  return plan;
}

export function assertReleaseSupportsRunner(input: {
  release: ReleaseTarget;
  runner: { platform: string; architecture: string };
}): void {
  const release = ReleaseTargetSchema.parse(input.release);
  assertReleaseCanTargetRollout(release.status);
  const supported = release.targets.some(
    (target) =>
      target.platform === input.runner.platform &&
      target.architecture === input.runner.architecture,
  );
  if (!supported) {
    throw new RunnerRolloutError(
      'runner_platform_incompatible',
      'The release does not declare an artifact for this Runner target.',
    );
  }
}

export function assertStageMayActivate(input: {
  rolloutStatus: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
  targetStatus: 'available' | 'deprecated' | 'blocked';
  stageNumber: number;
  previousStageStatus: RunnerRolloutStageStatus | null;
}): void {
  if (input.rolloutStatus !== 'active') {
    throw new RunnerRolloutError(
      'invalid_state_transition',
      'Only an active rollout can activate a stage.',
    );
  }
  assertReleaseCanTargetRollout(input.targetStatus);
  if (input.stageNumber > 1 && input.previousStageStatus !== 'completed') {
    throw new RunnerRolloutError(
      'stage_out_of_order',
      'The previous stage must converge before manual activation.',
    );
  }
}

export function assertNoActiveAssignmentConflict(input: {
  existingTargetReleaseId: string | null;
  targetReleaseId: string;
}): void {
  if (input.existingTargetReleaseId !== null) {
    throw new RunnerRolloutError(
      'runner_active_rollout_conflict',
      input.existingTargetReleaseId === input.targetReleaseId
        ? 'The Runner already belongs to another active rollout.'
        : 'The Runner has a conflicting active desired release.',
    );
  }
}
