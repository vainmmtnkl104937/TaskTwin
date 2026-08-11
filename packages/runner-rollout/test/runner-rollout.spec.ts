import { describe, expect, it } from 'vitest';

import type { RunnerCompatibilityEvaluation } from '@tasktwin/runner-release';
import {
  assertAssignmentTransition,
  assertNoActiveAssignmentConflict,
  assertReleaseCanTargetRollout,
  assertReleaseSupportsRunner,
  assertRolloutTransition,
  assertStageMayActivate,
  assertStageTransition,
  deriveRunnerCompliance,
  observeAssignmentVersion,
  runnerComplianceAllowsClaims,
  stageHasConverged,
  validateRolloutPlan,
} from '../src/index.js';

const compatible: RunnerCompatibilityEvaluation = {
  status: 'compatible',
  reasons: [],
};
const identity = {
  product: 'tasktwin-runner' as const,
  version: '1.0.0',
  runnerProtocolVersion: 2,
  workflowSchemaVersion: 1,
  localStateSchemaVersion: 1,
  platform: 'windows' as const,
  architecture: 'x64' as const,
};
const runnerA = '00000000-0000-4000-8000-000000000001';
const runnerB = '00000000-0000-4000-8000-000000000002';

describe('Runner compliance', () => {
  it('derives compliant, update available, required, unsupported and unknown', () => {
    const base = {
      actualIdentity: identity,
      compatibility: compatible,
      actualReleaseStatus: 'available' as const,
      desiredVersion: '1.0.0',
      assignmentStatus: null,
      localMaintenanceObserved: false,
    };
    expect(deriveRunnerCompliance(base)).toBe('compliant');
    expect(deriveRunnerCompliance({ ...base, desiredVersion: '1.1.0' })).toBe(
      'update_available',
    );
    expect(
      deriveRunnerCompliance({
        ...base,
        compatibility: {
          status: 'update_required',
          reasons: ['product_version_below_minimum'],
        },
      }),
    ).toBe('update_required');
    expect(
      deriveRunnerCompliance({ ...base, actualReleaseStatus: 'blocked' }),
    ).toBe('unsupported');
    expect(deriveRunnerCompliance({ ...base, actualIdentity: null })).toBe(
      'unknown',
    );
  });

  it('does not make deprecated compatible software unsupported', () => {
    expect(
      deriveRunnerCompliance({
        actualIdentity: identity,
        compatibility: compatible,
        actualReleaseStatus: 'deprecated',
        desiredVersion: '1.0.0',
        assignmentStatus: null,
        localMaintenanceObserved: false,
      }),
    ).toBe('compliant');
  });

  it('allows compatible update-available claims but denies required and unsupported', () => {
    expect(runnerComplianceAllowsClaims('update_available')).toBe(true);
    expect(runnerComplianceAllowsClaims('update_required')).toBe(false);
    expect(runnerComplianceAllowsClaims('unsupported')).toBe(false);
  });

  it('observes external maintenance and rollback state', () => {
    const base = {
      actualIdentity: identity,
      compatibility: compatible,
      actualReleaseStatus: 'available' as const,
      desiredVersion: '1.1.0',
      localMaintenanceObserved: true,
    };
    expect(
      deriveRunnerCompliance({ ...base, assignmentStatus: 'target_assigned' }),
    ).toBe('updating_external');
    expect(
      deriveRunnerCompliance({ ...base, assignmentStatus: 'rolled_back' }),
    ).toBe('rolled_back');
  });
});

describe('release and rollout validation', () => {
  it('allows only available releases as new targets', () => {
    expect(() => assertReleaseCanTargetRollout('available')).not.toThrow();
    expect(() => assertReleaseCanTargetRollout('deprecated')).toThrow();
    expect(() => assertReleaseCanTargetRollout('blocked')).toThrow();
  });

  it('accepts ordered explicit stages and rejects duplicate Runners', () => {
    const plan = {
      workspaceId: '00000000-0000-4000-8000-000000000010',
      targetReleaseId: '00000000-0000-4000-8000-000000000020',
      stages: [
        { stageNumber: 1, runnerDeviceIds: [runnerA] },
        { stageNumber: 2, runnerDeviceIds: [runnerB] },
      ],
    };
    expect(validateRolloutPlan(plan)).toEqual(plan);
    expect(() =>
      validateRolloutPlan({
        ...plan,
        stages: [
          { stageNumber: 1, runnerDeviceIds: [runnerA] },
          { stageNumber: 2, runnerDeviceIds: [runnerA] },
        ],
      }),
    ).toThrow(/more than one/i);
    expect(() =>
      validateRolloutPlan({
        ...plan,
        stages: [{ stageNumber: 2, runnerDeviceIds: [runnerA] }],
      }),
    ).toThrow(/contiguous/i);
  });

  it('requires manual ordered stage activation and detects conflicts', () => {
    expect(() =>
      assertStageMayActivate({
        rolloutStatus: 'active',
        targetStatus: 'available',
        stageNumber: 2,
        previousStageStatus: 'active',
      }),
    ).toThrow(/previous stage/i);
    expect(() =>
      assertStageMayActivate({
        rolloutStatus: 'active',
        targetStatus: 'available',
        stageNumber: 2,
        previousStageStatus: 'completed',
      }),
    ).not.toThrow();
    expect(() =>
      assertNoActiveAssignmentConflict({
        existingTargetReleaseId: 'release-a',
        targetReleaseId: 'release-b',
      }),
    ).toThrow(/conflicting/i);
  });

  it('requires an explicitly declared platform and architecture target', () => {
    const release = {
      id: '00000000-0000-4000-8000-000000000020',
      product: 'tasktwin-runner',
      version: '1.1.0',
      status: 'available' as const,
      targets: [{ platform: 'windows' as const, architecture: 'x64' as const }],
    };
    expect(() =>
      assertReleaseSupportsRunner({
        release,
        runner: { platform: 'windows', architecture: 'x64' },
      }),
    ).not.toThrow();
    expect(() =>
      assertReleaseSupportsRunner({
        release,
        runner: { platform: 'linux', architecture: 'x64' },
      }),
    ).toThrow(/does not declare/i);
  });
});

describe('deterministic state and convergence', () => {
  it('allows only declared lifecycle transitions', () => {
    expect(() => assertRolloutTransition('draft', 'active')).not.toThrow();
    expect(() => assertRolloutTransition('completed', 'active')).toThrow();
    expect(() => assertStageTransition('pending', 'active')).not.toThrow();
    expect(() => assertStageTransition('completed', 'active')).toThrow();
    expect(() =>
      assertAssignmentTransition('target_assigned', 'converged'),
    ).not.toThrow();
  });

  it('converges only from authenticated target version observation', () => {
    expect(
      observeAssignmentVersion({
        assignmentStatus: 'target_assigned',
        targetVersion: '1.1.0',
        baselineVersion: '1.0.0',
        actualVersion: '1.0.0',
      }).outcome,
    ).toBe('unchanged');
    expect(
      observeAssignmentVersion({
        assignmentStatus: 'target_assigned',
        targetVersion: '1.1.0',
        baselineVersion: '1.0.0',
        actualVersion: '1.1.0',
      }).outcome,
    ).toBe('converged');
  });

  it('detects rollback after convergence and never proposes a retry', () => {
    expect(
      observeAssignmentVersion({
        assignmentStatus: 'converged',
        targetVersion: '1.1.0',
        baselineVersion: '1.0.0',
        actualVersion: '1.0.0',
      }),
    ).toEqual({ outcome: 'rolled_back', assignmentStatus: 'rolled_back' });
    expect(stageHasConverged(['converged', 'target_assigned'])).toBe(false);
    expect(stageHasConverged(['converged', 'converged'])).toBe(true);
  });
});
