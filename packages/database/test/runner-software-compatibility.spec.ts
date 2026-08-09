import { describe, expect, it } from 'vitest';

import {
  CONTROL_PLANE_RUNNER_COMPATIBILITY_POLICY,
  canRunnerClaimJobs,
  evaluatePersistedRunnerCompatibility,
  toPersistedRunnerSoftwareIdentity,
} from '../src/index.js';

function runner(
  overrides: Partial<
    Parameters<typeof evaluatePersistedRunnerCompatibility>[0]
  > = {},
) {
  return {
    runnerVersion: '0.1.0',
    platform: 'win32',
    architecture: 'x64',
    runProtocolVersion: 2,
    workflowSchemaVersion: 1,
    localStateSchemaVersion: 1,
    ...overrides,
  };
}

describe('persisted Runner software compatibility', () => {
  it.each([
    ['0.1.0', 'compatible', true],
    ['0.0.9', 'update_required', false],
  ] as const)('classifies version %s as %s', (version, status, claimable) => {
    const decision = evaluatePersistedRunnerCompatibility(
      runner({ runnerVersion: version }),
    );
    expect(decision.status).toBe(status);
    expect(canRunnerClaimJobs(decision)).toBe(claimable);
  });

  it('allows an explicitly supported version below a future recommendation', () => {
    const decision = evaluatePersistedRunnerCompatibility(runner(), {
      ...CONTROL_PLANE_RUNNER_COMPATIBILITY_POLICY,
      recommendedVersion: '0.2.0',
    });
    expect(decision).toEqual({
      status: 'update_recommended',
      reasons: ['product_update_recommended'],
    });
    expect(canRunnerClaimJobs(decision)).toBe(true);
  });

  it('requires complete metadata and rejects unsupported protocol versions', () => {
    expect(
      evaluatePersistedRunnerCompatibility(
        runner({ localStateSchemaVersion: null }),
      ),
    ).toEqual({
      status: 'update_required',
      reasons: ['software_identity_missing'],
    });
    expect(
      evaluatePersistedRunnerCompatibility(runner({ runProtocolVersion: 99 })),
    ).toEqual({
      status: 'unsupported',
      reasons: ['runner_protocol_unsupported'],
    });
  });

  it('maps existing source-Runner platforms independently of release artifacts', () => {
    expect(toPersistedRunnerSoftwareIdentity(runner())).toMatchObject({
      platform: 'windows',
      architecture: 'x64',
    });
    expect(
      toPersistedRunnerSoftwareIdentity(
        runner({ platform: 'darwin', architecture: 'arm64' }),
      ),
    ).toMatchObject({ platform: 'macos', architecture: 'arm64' });
    expect(
      evaluatePersistedRunnerCompatibility(
        runner({ platform: 'linux', architecture: 'arm64' }),
      ).status,
    ).toBe('compatible');
    expect(
      evaluatePersistedRunnerCompatibility(runner({ platform: 'freebsd' })),
    ).toEqual({
      status: 'update_required',
      reasons: ['software_identity_missing'],
    });
  });
});
