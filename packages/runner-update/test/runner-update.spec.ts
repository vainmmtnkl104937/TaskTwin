import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ReleaseManifestSchema,
  RunnerSoftwareIdentitySchema,
  type ReleaseManifest,
} from '@tasktwin/runner-release';
import { describe, expect, it } from 'vitest';

import {
  ActiveReleaseRecordSchema,
  InstalledReleaseRecordSchema,
  RunnerStartupStatusSchema,
  RunnerUpdateError,
  RunnerUpdateIdSchema,
  RunnerUpdateJournalSchema,
  assertRunnerUpdateStateTransition,
  canTransitionRunnerUpdateState,
  createRunnerUpdatePlan,
  decideCrashRecovery,
  decideReleaseRetention,
  deriveRunnerReleaseId,
  deriveRunnerUpdateId,
  evaluateRunnerUpdatePreflight,
  evaluateRunnerInstallationCompatibility,
  evaluateRunnerRollbackCompatibility,
  evaluateTargetHealth,
  summarizeInstalledRelease,
  summarizeRunnerUpdate,
  RunnerUpdatePlanSchema,
  type InstalledReleaseRecord,
  type RunnerControlPlaneAcknowledgement,
  type RunnerStartupStatus,
  type RunnerUpdateJournal,
  type RunnerUpdateState,
} from '../src/index.js';

const SOURCE_COMMIT = 'b'.repeat(40);
const KEY_ID = 'runner-release-test-1';
const TIMESTAMP = '2026-08-09T00:00:00.000Z';

interface ManifestOptions {
  localReadable?: number[];
  localWritable?: number;
  vaultReadable?: number[];
  vaultWritable?: number;
  vaultProfiles?: string[];
}

function manifestFixture(
  version: string,
  options: ManifestOptions = {},
): ReleaseManifest {
  const localReadable = options.localReadable ?? [1];
  const localWritable = options.localWritable ?? 1;
  const vaultReadable = options.vaultReadable ?? [1];
  const vaultWritable = options.vaultWritable ?? 1;
  return ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: 'tasktwin-runner',
    version,
    channel: 'stable',
    sourceCommit: SOURCE_COMMIT,
    builtAt: TIMESTAMP,
    compatibility: {
      runnerProtocolVersion: 2,
      workflowSchema: { readable: { min: 1, max: 1 } },
      localState: {
        readableSchemas: localReadable,
        writableSchema: localWritable,
      },
      localSecretVault: {
        readableSchemas: vaultReadable,
        writableSchema: vaultWritable,
        readableProtectionProfiles: options.vaultProfiles ?? [
          'windows_dpapi_ng_machine_v1',
        ],
      },
    },
    artifacts: [
      {
        platform: 'windows',
        architecture: 'x64',
        fileName: `tasktwin-runner-${version}-windows-x64.zip`,
        archiveFormat: 'zip',
        sizeBytes: 42,
        sha256: 'a'.repeat(64),
      },
    ],
    signingKeyId: KEY_ID,
  });
}

function installedReleaseFixture(
  version: string,
  digestCharacter: string,
  installedAt = TIMESTAMP,
): InstalledReleaseRecord {
  const manifestSha256 = digestCharacter.repeat(64);
  return InstalledReleaseRecordSchema.parse({
    schemaVersion: 1,
    releaseId: deriveRunnerReleaseId(manifestSha256),
    product: 'tasktwin-runner',
    version,
    sourceCommit: SOURCE_COMMIT,
    platform: 'windows',
    architecture: 'x64',
    signingKeyId: KEY_ID,
    manifestSha256,
    artifact: {
      platform: 'windows',
      architecture: 'x64',
      fileName: `tasktwin-runner-${version}-windows-x64.zip`,
      archiveFormat: 'zip',
      sizeBytes: 42,
      sha256: 'd'.repeat(64),
    },
    installedAt,
  });
}

function journalFixture(state: RunnerUpdateState): RunnerUpdateJournal {
  const failureCode =
    state === 'failed_before_switch' || state === 'manual_recovery_required'
      ? { failureCode: 'update_manual_recovery_required' as const }
      : {};
  return RunnerUpdateJournalSchema.parse({
    schemaVersion: 1,
    revision: 1,
    operation: 'apply',
    updateId: `ru1_${'e'.repeat(64)}`,
    state,
    sourceReleaseId: deriveRunnerReleaseId('a'.repeat(64)),
    targetReleaseId: deriveRunnerReleaseId('b'.repeat(64)),
    fromVersion: '1.0.0',
    targetVersion: '1.1.0',
    sourceManifestSha256: 'a'.repeat(64),
    targetManifestSha256: 'b'.repeat(64),
    sourceArtifactSha256: 'c'.repeat(64),
    targetArtifactSha256: 'd'.repeat(64),
    startedAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...failureCode,
  });
}

const targetSoftwareIdentity = RunnerSoftwareIdentitySchema.parse({
  product: 'tasktwin-runner',
  version: '1.1.0',
  runnerProtocolVersion: 2,
  workflowSchemaVersion: 1,
  localStateSchemaVersion: 1,
  platform: 'windows',
  architecture: 'x64',
});

function startupStatusFixture(
  overrides: Partial<RunnerStartupStatus> = {},
): RunnerStartupStatus {
  return RunnerStartupStatusSchema.parse({
    schemaVersion: 1,
    activationId: 'activation-1',
    startupAttemptId: 'startup-1',
    softwareIdentity: targetSoftwareIdentity,
    state: 'healthy',
    observedAt: TIMESTAMP,
    acceptsNewJobs: false,
    activeWork: false,
    checks: {
      identity: 'passed',
      instanceLock: 'passed',
      workflowEngine: 'passed',
      policyRuntime: 'passed',
      chromium: 'passed',
      localSecretStore: 'passed',
      nativeSecretAutoUnlock: 'passed',
    },
    controlPlaneAcknowledgement: 'offline',
    ...overrides,
  });
}

function healthInput(
  startupStatus: RunnerStartupStatus | null,
  overrides: {
    deadlineExpired?: boolean;
    scmState?: 'starting' | 'running' | 'stopped' | 'unknown';
    controlPlaneAcknowledgement?: RunnerControlPlaneAcknowledgement;
    requireNativeSecretAutoUnlock?: boolean;
  } = {},
) {
  return {
    expectedActivationId: 'activation-1',
    expectedStartupAttemptId: 'startup-1',
    expectedSoftwareIdentity: targetSoftwareIdentity,
    scmState: overrides.scmState ?? ('running' as const),
    scmExecutableMatches: true,
    startupStatus,
    controlPlaneAcknowledgement:
      overrides.controlPlaneAcknowledgement ?? ('offline' as const),
    deadlineExpired: overrides.deadlineExpired ?? false,
    requireNativeSecretAutoUnlock:
      overrides.requireNativeSecretAutoUnlock ?? true,
  };
}

describe('strict update records', () => {
  it('validates installed and active release records', () => {
    const installed = installedReleaseFixture('1.0.0', 'a');
    expect(installed.releaseId).toBe(`rr1_${'a'.repeat(64)}`);
    expect(
      ActiveReleaseRecordSchema.parse({
        schemaVersion: 1,
        generation: 1,
        currentReleaseId: installed.releaseId,
        previousReleaseId: null,
        currentActivationId: 'activation-1',
        activatedAt: TIMESTAMP,
      }).currentReleaseId,
    ).toBe(installed.releaseId);
  });

  it('rejects unexpected or path-bearing properties', () => {
    expect(() =>
      InstalledReleaseRecordSchema.parse({
        ...installedReleaseFixture('1.0.0', 'a'),
        payloadPath: 'C:\\TaskTwin\\vault',
      }),
    ).toThrow();
    expect(() =>
      RunnerUpdateJournalSchema.parse({
        ...journalFixture('staging'),
        artifactPath: 'C:\\release.zip',
      }),
    ).toThrow();
    expect(() =>
      RunnerStartupStatusSchema.parse({
        ...startupStatusFixture(),
        machineName: 'BUILD-HOST',
      }),
    ).toThrow();
  });

  it('binds release IDs and artifact names to signed identity metadata', () => {
    const release = installedReleaseFixture('1.0.0', 'a');
    expect(() =>
      InstalledReleaseRecordSchema.parse({
        ...release,
        releaseId: `rr1_${'f'.repeat(64)}`,
      }),
    ).toThrow();
    expect(() =>
      InstalledReleaseRecordSchema.parse({
        ...release,
        artifact: { ...release.artifact, fileName: 'runner.zip' },
      }),
    ).toThrow();
  });

  it('rejects ambiguous active pointers and non-normalized timestamps', () => {
    const releaseId = deriveRunnerReleaseId('a'.repeat(64));
    expect(() =>
      ActiveReleaseRecordSchema.parse({
        schemaVersion: 1,
        generation: 1,
        currentReleaseId: releaseId,
        previousReleaseId: releaseId,
        currentActivationId: 'activation-1',
        activatedAt: TIMESTAMP,
      }),
    ).toThrow();
    expect(() =>
      InstalledReleaseRecordSchema.parse({
        ...installedReleaseFixture('1.0.0', 'a'),
        installedAt: '2026-08-09T07:00:00.000+07:00',
      }),
    ).toThrow();
  });

  it('requires stable errors in failed journal states', () => {
    const base = journalFixture('staging');
    expect(() =>
      RunnerUpdateJournalSchema.parse({
        ...base,
        state: 'manual_recovery_required',
      }),
    ).toThrow();
    expect(() =>
      RunnerUpdateJournalSchema.parse({
        ...base,
        failureCode: 'update_staging_failed',
      }),
    ).toThrow();
  });
});

describe('deterministic update identity', () => {
  const input = {
    operation: 'apply' as const,
    sourceManifestSha256: 'a'.repeat(64),
    targetManifestSha256: 'b'.repeat(64),
  };

  it('derives a stable bounded ID through an injected hasher', () => {
    const hasher = { sha256Hex: () => 'c'.repeat(64) };
    expect(deriveRunnerUpdateId(input, hasher)).toBe(`ru1_${'c'.repeat(64)}`);
    expect(deriveRunnerUpdateId(input, hasher)).toBe(
      deriveRunnerUpdateId({ ...input }, hasher),
    );
    expect(RunnerUpdateIdSchema.parse(`ru1_${'c'.repeat(64)}`)).toHaveLength(
      68,
    );
  });

  it('includes the operation and both release digests in hash material', () => {
    const observed: string[] = [];
    const hasher = {
      sha256Hex(value: string) {
        observed.push(value);
        return 'd'.repeat(64);
      },
    };
    deriveRunnerUpdateId(input, hasher);
    expect(observed[0]).toContain('operation=apply');
    expect(observed[0]).toContain(`source=${'a'.repeat(64)}`);
    expect(observed[0]).toContain(`target=${'b'.repeat(64)}`);
  });

  it('fails closed when the hasher returns a malformed digest', () => {
    expect(() =>
      deriveRunnerUpdateId(input, { sha256Hex: () => 'not-a-digest' }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerUpdateError>>({
        code: 'update_id_invalid',
      }),
    );
  });
});

describe('update state machine', () => {
  it('allows the production apply sequence', () => {
    const sequence: RunnerUpdateState[] = [
      'idle',
      'preparing',
      'draining',
      'staging',
      'ready_to_switch',
      'switching',
      'starting_target',
      'verifying_target',
      'succeeded',
      'idle',
    ];
    for (let index = 1; index < sequence.length; index += 1) {
      expect(
        canTransitionRunnerUpdateState(sequence[index - 1]!, sequence[index]!),
      ).toBe(true);
    }
  });

  it('allows bounded pre-switch failure and rollback paths', () => {
    expect(
      canTransitionRunnerUpdateState('draining', 'failed_before_switch'),
    ).toBe(true);
    expect(
      canTransitionRunnerUpdateState('verifying_target', 'rolling_back'),
    ).toBe(true);
    expect(canTransitionRunnerUpdateState('rolling_back', 'rolled_back')).toBe(
      true,
    );
    expect(canTransitionRunnerUpdateState('draining', 'rolling_back')).toBe(
      true,
    );
    expect(
      canTransitionRunnerUpdateState('switching', 'failed_before_switch'),
    ).toBe(true);
  });

  it('rejects skipping staging and makes manual recovery absorbing', () => {
    expect(canTransitionRunnerUpdateState('draining', 'switching')).toBe(false);
    expect(
      canTransitionRunnerUpdateState('manual_recovery_required', 'idle'),
    ).toBe(false);
    expect(() =>
      assertRunnerUpdateStateTransition('idle', 'switching'),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerUpdateError>>({
        code: 'update_state_transition_invalid',
      }),
    );
  });
});

describe('bidirectional update preflight', () => {
  const compatibleInput = {
    currentRelease: manifestFixture('1.0.0'),
    targetRelease: manifestFixture('1.1.0'),
    currentLocalStateSchemaVersion: 1,
    currentLocalSecretVault: {
      schemaVersion: 1,
      protectionProfile: 'windows_dpapi_ng_machine_v1',
    },
    platform: 'windows' as const,
    architecture: 'x64' as const,
  };

  it('allows only an upgrade compatible in both directions', () => {
    const result = evaluateRunnerUpdatePreflight(compatibleInput);
    expect(result).toMatchObject({
      decision: 'allowed',
      reasons: [],
      forward: { decision: 'compatible' },
      rollback: { decision: 'compatible' },
    });
  });

  it('is deterministic and does not mutate preflight input', () => {
    const before = structuredClone(compatibleInput);
    const first = evaluateRunnerUpdatePreflight(compatibleInput);
    const second = evaluateRunnerUpdatePreflight(compatibleInput);
    expect(first).toEqual(second);
    expect(compatibleInput).toEqual(before);
  });

  it('blocks migration-required updates', () => {
    const result = evaluateRunnerUpdatePreflight({
      ...compatibleInput,
      targetRelease: manifestFixture('1.1.0', {
        localReadable: [1, 2],
        localWritable: 2,
      }),
    });
    expect(result.decision).toBe('blocked');
    expect(result.forward.decision).toBe('migration_required');
    expect(result.reasons).toContain('forward_migration_required');
  });

  it('blocks a target unable to read current local state', () => {
    const result = evaluateRunnerUpdatePreflight({
      ...compatibleInput,
      targetRelease: manifestFixture('1.1.0', {
        localReadable: [2],
        localWritable: 2,
      }),
    });
    expect(result.forward.decision).toBe('unsupported');
    expect(result.reasons).toContain('forward_compatibility_unsupported');
  });

  it('blocks when the retained current release cannot read target state', () => {
    const result = evaluateRunnerUpdatePreflight({
      ...compatibleInput,
      currentRelease: manifestFixture('1.0.0', {
        localReadable: [2],
        localWritable: 2,
      }),
    });
    expect(result.forward.decision).toBe('compatible');
    expect(result.rollback.decision).toBe('downgrade_blocked');
    expect(result.reasons).toContain('rollback_downgrade_blocked');
  });

  it('proves the retained release can read the unchanged vault profile', () => {
    const result = evaluateRunnerUpdatePreflight({
      ...compatibleInput,
      currentRelease: manifestFixture('1.0.0', {
        vaultProfiles: ['local_secret_master_key_wrap_v1'],
      }),
    });
    expect(result.rollback.decision).toBe('downgrade_blocked');
    expect(result.rollback.reasons).toContain(
      'local_secret_vault_profile_unreadable',
    );
  });

  it('blocks same-version replacement and product downgrade apply', () => {
    const same = evaluateRunnerUpdatePreflight({
      ...compatibleInput,
      targetRelease: manifestFixture('1.0.0'),
    });
    expect(same.reasons).toContain('target_version_not_newer');
    const older = evaluateRunnerUpdatePreflight({
      ...compatibleInput,
      targetRelease: manifestFixture('0.9.0'),
    });
    expect(older.reasons).toContain('target_version_not_newer');
  });

  it('preserves a null-vault installation without inventing vault state', () => {
    const result = evaluateRunnerUpdatePreflight({
      ...compatibleInput,
      currentLocalSecretVault: null,
    });
    expect(result.decision).toBe('allowed');
    expect(result.rollback.decision).toBe('compatible');
  });

  it('rechecks rollback against state as it exists immediately before switch-back', () => {
    const safe = evaluateRunnerRollbackCompatibility({
      currentVersion: '1.1.0',
      rollbackRelease: manifestFixture('1.0.0'),
      currentLocalStateSchemaVersion: 1,
      currentLocalSecretVault: {
        schemaVersion: 1,
        protectionProfile: 'windows_dpapi_ng_machine_v1',
      },
      platform: 'windows',
      architecture: 'x64',
    });
    expect(safe).toMatchObject({
      decision: 'safe',
      preflight: { decision: 'compatible' },
    });

    const unsafe = evaluateRunnerRollbackCompatibility({
      currentVersion: '1.1.0',
      rollbackRelease: manifestFixture('1.0.0'),
      currentLocalStateSchemaVersion: 2,
      currentLocalSecretVault: null,
      platform: 'windows',
      architecture: 'x64',
    });
    expect(unsafe.decision).toBe('unsafe');
    expect(unsafe.preflight.decision).toBe('downgrade_blocked');
  });
});

describe('installation compatibility and deterministic plans', () => {
  const currentRelease = manifestFixture('1.0.0');
  const targetRelease = manifestFixture('1.1.0');
  const compatibilityInput = {
    currentRelease,
    targetRelease,
    supportedRunnerProtocolVersions: [2],
    requiredWorkflowSchemaVersion: 1,
    currentServiceStateSchemaVersion: 1,
  };

  it('evaluates protocol, Workflow, and service state independently of SemVer', () => {
    expect(evaluateRunnerInstallationCompatibility(compatibilityInput)).toEqual(
      { decision: 'compatible', reasons: [] },
    );

    const unsupportedProtocol = manifestFixture('1.1.0');
    unsupportedProtocol.compatibility.runnerProtocolVersion = 99;
    expect(
      evaluateRunnerInstallationCompatibility({
        ...compatibilityInput,
        targetRelease: unsupportedProtocol,
      }).reasons,
    ).toContain('target_runner_protocol_unsupported');

    const unsupportedServiceState = manifestFixture('1.1.0', {
      localReadable: [2],
      localWritable: 2,
    });
    expect(
      evaluateRunnerInstallationCompatibility({
        ...compatibilityInput,
        targetRelease: unsupportedServiceState,
      }).reasons,
    ).toContain('target_service_state_schema_unsupported');
  });

  it('detects a rollback source unable to read the required Workflow schema', () => {
    const source = manifestFixture('1.0.0');
    source.compatibility.workflowSchema.readable = { min: 2, max: 2 };
    const result = evaluateRunnerInstallationCompatibility({
      ...compatibilityInput,
      currentRelease: source,
    });
    expect(result.decision).toBe('unsupported');
    expect(result.reasons).toContain('source_workflow_schema_unsupported');
  });

  it('creates a safe deterministic plan only from allowed proofs', () => {
    const preflight = evaluateRunnerUpdatePreflight({
      currentRelease,
      targetRelease,
      currentLocalStateSchemaVersion: 1,
      currentLocalSecretVault: {
        schemaVersion: 1,
        protectionProfile: 'windows_dpapi_ng_machine_v1',
      },
      platform: 'windows',
      architecture: 'x64',
    });
    const installationCompatibility =
      evaluateRunnerInstallationCompatibility(compatibilityInput);
    const planInput = {
      preflight,
      installationCompatibility,
      platform: 'windows' as const,
      architecture: 'x64' as const,
      sourceManifestSha256: 'a'.repeat(64),
      targetManifestSha256: 'b'.repeat(64),
      sourceArtifactSha256: 'c'.repeat(64),
      targetArtifactSha256: 'd'.repeat(64),
      requireNativeSecretAutoUnlock: true,
    };
    const plan = createRunnerUpdatePlan(planInput, {
      sha256Hex: () => 'e'.repeat(64),
    });
    expect(plan).toMatchObject({
      operation: 'apply',
      updateId: `ru1_${'e'.repeat(64)}`,
      sourceReleaseId: `rr1_${'a'.repeat(64)}`,
      targetReleaseId: `rr1_${'b'.repeat(64)}`,
      fromVersion: '1.0.0',
      targetVersion: '1.1.0',
      requireNativeSecretAutoUnlock: true,
    });
    expect(() =>
      RunnerUpdatePlanSchema.parse({
        ...plan,
        artifactPath: 'C:\\release.zip',
      }),
    ).toThrow();
  });

  it('refuses to plan a migration-required or installation-incompatible update', () => {
    const migrationTarget = manifestFixture('1.1.0', {
      localReadable: [1, 2],
      localWritable: 2,
    });
    const blockedPreflight = evaluateRunnerUpdatePreflight({
      currentRelease,
      targetRelease: migrationTarget,
      currentLocalStateSchemaVersion: 1,
      currentLocalSecretVault: null,
      platform: 'windows',
      architecture: 'x64',
    });
    const compatible =
      evaluateRunnerInstallationCompatibility(compatibilityInput);
    const basePlan = {
      preflight: blockedPreflight,
      installationCompatibility: compatible,
      platform: 'windows' as const,
      architecture: 'x64' as const,
      sourceManifestSha256: 'a'.repeat(64),
      targetManifestSha256: 'b'.repeat(64),
      sourceArtifactSha256: 'c'.repeat(64),
      targetArtifactSha256: 'd'.repeat(64),
      requireNativeSecretAutoUnlock: false,
    };
    expect(() =>
      createRunnerUpdatePlan(basePlan, {
        sha256Hex: () => 'e'.repeat(64),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerUpdateError>>({
        code: 'update_migration_required',
      }),
    );

    const unsupported = evaluateRunnerInstallationCompatibility({
      ...compatibilityInput,
      supportedRunnerProtocolVersions: [99],
    });
    expect(() =>
      createRunnerUpdatePlan(
        {
          ...basePlan,
          preflight: evaluateRunnerUpdatePreflight({
            currentRelease,
            targetRelease,
            currentLocalStateSchemaVersion: 1,
            currentLocalSecretVault: null,
            platform: 'windows',
            architecture: 'x64',
          }),
          installationCompatibility: unsupported,
        },
        { sha256Hex: () => 'e'.repeat(64) },
      ),
    ).toThrowError(RunnerUpdateError);
  });
});

describe('target startup health', () => {
  it('accepts full local health while the Control Plane is offline', () => {
    const result = evaluateTargetHealth(
      healthInput(startupStatusFixture(), {
        controlPlaneAcknowledgement: 'offline',
      }),
    );
    expect(result).toEqual({
      decision: 'healthy',
      reasons: [],
      observedVersion: '1.1.0',
    });
  });

  it('keeps a missing startup report pending until its deadline', () => {
    expect(
      evaluateTargetHealth(
        healthInput(null, { scmState: 'starting', deadlineExpired: false }),
      ).decision,
    ).toBe('pending');
    const expired = evaluateTargetHealth(
      healthInput(null, { scmState: 'starting', deadlineExpired: true }),
    );
    expect(expired.decision).toBe('unhealthy');
    expect(expired.reasons).toContain('health_deadline_expired');
  });

  it('treats a transitional unknown SCM state as pending until the deadline', () => {
    const pending = evaluateTargetHealth({
      ...healthInput(null, { scmState: 'unknown' }),
      scmExecutableMatches: false,
    });
    expect(pending.decision).toBe('pending');
    const expired = evaluateTargetHealth({
      ...healthInput(null, {
        scmState: 'unknown',
        deadlineExpired: true,
      }),
      scmExecutableMatches: false,
    });
    expect(expired.decision).toBe('unhealthy');
    expect(expired.reasons).toContain('health_deadline_expired');
  });

  it('rejects a stale activation or startup-attempt report', () => {
    expect(
      evaluateTargetHealth(
        healthInput(startupStatusFixture({ activationId: 'old-activation' })),
      ).reasons,
    ).toContain('startup_activation_mismatch');
    expect(
      evaluateTargetHealth(
        healthInput(startupStatusFixture({ startupAttemptId: 'old-attempt' })),
      ).reasons,
    ).toContain('startup_attempt_mismatch');
  });

  it('rejects an actual target-version mismatch', () => {
    const mismatch = startupStatusFixture({
      softwareIdentity: {
        ...targetSoftwareIdentity,
        version: '1.0.0',
      },
    });
    const result = evaluateTargetHealth(healthInput(mismatch));
    expect(result.decision).toBe('unhealthy');
    expect(result.reasons).toContain('software_identity_mismatch');
  });

  it('requires claim admission to remain closed and no active work', () => {
    const result = evaluateTargetHealth(
      healthInput(
        startupStatusFixture({ acceptsNewJobs: true, activeWork: true }),
      ),
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining(['claim_admission_open', 'active_work_present']),
    );
  });

  it('requires every local component check', () => {
    const status = startupStatusFixture({
      checks: {
        ...startupStatusFixture().checks,
        chromium: 'failed',
      },
    });
    expect(evaluateTargetHealth(healthInput(status)).reasons).toContain(
      'chromium_check_failed',
    );
  });

  it('keeps incomplete component initialization pending, then times out', () => {
    const status = startupStatusFixture({
      state: 'starting',
      checks: {
        ...startupStatusFixture().checks,
        chromium: 'pending',
      },
    });
    expect(evaluateTargetHealth(healthInput(status)).decision).toBe('pending');
    const expired = evaluateTargetHealth(
      healthInput(status, { deadlineExpired: true }),
    );
    expect(expired.decision).toBe('unhealthy');
    expect(expired.reasons).toContain('health_deadline_expired');
  });

  it('requires native unlock only when the prior installation requires it', () => {
    const status = startupStatusFixture({
      checks: {
        ...startupStatusFixture().checks,
        nativeSecretAutoUnlock: 'not_required',
      },
    });
    expect(evaluateTargetHealth(healthInput(status)).reasons).toContain(
      'native_secret_auto_unlock_failed',
    );
    expect(
      evaluateTargetHealth(
        healthInput(status, { requireNativeSecretAutoUnlock: false }),
      ).decision,
    ).toBe('healthy');
  });

  it('fails on an explicit incompatible Control Plane acknowledgement', () => {
    const result = evaluateTargetHealth(
      healthInput(startupStatusFixture(), {
        controlPlaneAcknowledgement: 'unsupported',
      }),
    );
    expect(result.decision).toBe('unhealthy');
    expect(result.reasons).toContain('control_plane_rejected');
  });

  it('accepts an update-recommended Control Plane acknowledgement', () => {
    const status = startupStatusFixture({
      controlPlaneAcknowledgement: 'update_recommended',
    });
    expect(
      evaluateTargetHealth(
        healthInput(status, {
          controlPlaneAcknowledgement: 'update_recommended',
        }),
      ).decision,
    ).toBe('healthy');
  });
});

describe('crash recovery decisions', () => {
  const observation = {
    observedServiceRelease: 'source' as const,
    targetHealth: 'pending' as const,
    sourceHealth: 'healthy' as const,
    rollbackSafety: 'safe' as const,
  };

  it('does nothing without a journal or for a terminal journal', () => {
    expect(decideCrashRecovery({ ...observation, journal: null }).action).toBe(
      'no_action',
    );
    expect(
      decideCrashRecovery({
        ...observation,
        journal: journalFixture('succeeded'),
      }).action,
    ).toBe('no_action');
  });

  it('fails safely before switch when the source remains selected', () => {
    const result = decideCrashRecovery({
      ...observation,
      journal: journalFixture('staging'),
    });
    expect(result).toMatchObject({
      action: 'fail_before_switch',
      nextState: 'failed_before_switch',
    });
  });

  it('marks a switching journal failed-before-switch when SCM never left source', () => {
    const result = decideCrashRecovery({
      ...observation,
      journal: journalFixture('switching'),
      observedServiceRelease: 'source',
    });
    expect(result).toMatchObject({
      action: 'fail_before_switch',
      reason: 'source_intact_before_switch',
      nextState: 'failed_before_switch',
    });
    expect(canTransitionRunnerUpdateState('switching', result.nextState!)).toBe(
      true,
    );
    expect(() =>
      assertRunnerUpdateStateTransition('switching', result.nextState!),
    ).not.toThrow();
  });

  it('requires manual recovery for ambiguous pre-switch service state', () => {
    const result = decideCrashRecovery({
      ...observation,
      journal: journalFixture('ready_to_switch'),
      observedServiceRelease: 'ambiguous',
    });
    expect(result.action).toBe('manual_recovery');
  });

  it('resumes or completes verification of a selected target', () => {
    expect(
      decideCrashRecovery({
        ...observation,
        journal: journalFixture('starting_target'),
        observedServiceRelease: 'target',
        targetHealth: 'pending',
      }).action,
    ).toBe('resume_target_verification');
    expect(
      decideCrashRecovery({
        ...observation,
        journal: journalFixture('verifying_target'),
        observedServiceRelease: 'target',
        targetHealth: 'healthy',
      }).action,
    ).toBe('complete_target');
  });

  it('rolls back an unhealthy target only with proven safety', () => {
    expect(
      decideCrashRecovery({
        ...observation,
        journal: journalFixture('verifying_target'),
        observedServiceRelease: 'target',
        targetHealth: 'unhealthy',
      }).action,
    ).toBe('begin_rollback');
    expect(
      decideCrashRecovery({
        ...observation,
        journal: journalFixture('verifying_target'),
        observedServiceRelease: 'target',
        targetHealth: 'unhealthy',
        rollbackSafety: 'unknown',
      }).action,
    ).toBe('manual_recovery');
  });

  it('does not complete a healthy target after rollback safety becomes ambiguous', () => {
    expect(
      decideCrashRecovery({
        ...observation,
        journal: journalFixture('verifying_target'),
        observedServiceRelease: 'target',
        targetHealth: 'healthy',
        rollbackSafety: 'unknown',
      }).action,
    ).toBe('manual_recovery');
  });

  it('finishes a healthy source or retries a selected target rollback', () => {
    expect(
      decideCrashRecovery({
        ...observation,
        journal: journalFixture('rolling_back'),
      }).action,
    ).toBe('complete_rollback');
    expect(
      decideCrashRecovery({
        ...observation,
        journal: journalFixture('rolling_back'),
        observedServiceRelease: 'target',
      }).action,
    ).toBe('retry_rollback');
  });
});

describe('release retention', () => {
  const releaseA = installedReleaseFixture(
    '1.0.0',
    'a',
    '2026-08-07T00:00:00.000Z',
  );
  const releaseB = installedReleaseFixture(
    '1.1.0',
    'b',
    '2026-08-08T00:00:00.000Z',
  );
  const releaseC = installedReleaseFixture(
    '1.2.0',
    'c',
    '2026-08-09T00:00:00.000Z',
  );
  const activeC = ActiveReleaseRecordSchema.parse({
    schemaVersion: 1,
    generation: 3,
    currentReleaseId: releaseC.releaseId,
    previousReleaseId: releaseB.releaseId,
    currentActivationId: 'activation-c',
    activatedAt: TIMESTAMP,
  });

  it('keeps current and previous and selects older release removal', () => {
    const result = decideReleaseRetention({
      installedReleases: [releaseA, releaseB, releaseC],
      activeRelease: activeC,
      journal: journalFixture('succeeded'),
    });
    expect(result.keepReleaseIds).toEqual([
      releaseB.releaseId,
      releaseC.releaseId,
    ]);
    expect(result.removeReleaseIds).toEqual([releaseA.releaseId]);
  });

  it('temporarily retains every nonterminal journal release', () => {
    const activeB = ActiveReleaseRecordSchema.parse({
      ...activeC,
      generation: 2,
      currentReleaseId: releaseB.releaseId,
      previousReleaseId: releaseA.releaseId,
      currentActivationId: 'activation-b',
    });
    const journal = RunnerUpdateJournalSchema.parse({
      ...journalFixture('staging'),
      sourceReleaseId: releaseB.releaseId,
      targetReleaseId: releaseC.releaseId,
    });
    const result = decideReleaseRetention({
      installedReleases: [releaseA, releaseB, releaseC],
      activeRelease: activeB,
      journal,
    });
    expect(result.keepReleaseIds).toEqual([
      releaseA.releaseId,
      releaseB.releaseId,
      releaseC.releaseId,
    ]);
    expect(result.removeReleaseIds).toEqual([]);
  });

  it('does not clean anything in manual recovery', () => {
    const result = decideReleaseRetention({
      installedReleases: [releaseA, releaseB, releaseC],
      activeRelease: activeC,
      journal: journalFixture('manual_recovery_required'),
    });
    expect(result.removeReleaseIds).toEqual([]);
  });

  it('returns the same retention sets regardless of input ordering', () => {
    const forward = decideReleaseRetention({
      installedReleases: [releaseA, releaseB, releaseC],
      activeRelease: activeC,
      journal: null,
    });
    const reversed = decideReleaseRetention({
      installedReleases: [releaseC, releaseB, releaseA],
      activeRelease: activeC,
      journal: null,
    });
    expect(reversed).toEqual(forward);
  });

  it('rejects missing and duplicate active release evidence', () => {
    expect(() =>
      decideReleaseRetention({
        installedReleases: [releaseA, releaseB],
        activeRelease: activeC,
        journal: null,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerUpdateError>>({
        code: 'update_retention_invalid',
      }),
    );
    expect(() =>
      decideReleaseRetention({
        installedReleases: [releaseB, releaseB, releaseC],
        activeRelease: activeC,
        journal: null,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RunnerUpdateError>>({
        code: 'update_retention_invalid',
      }),
    );
  });
});

describe('safe summaries and framework independence', () => {
  it('omits paths, digests, signing metadata, and protected local data', () => {
    const summary = summarizeRunnerUpdate(journalFixture('staging'));
    const installed = summarizeInstalledRelease(
      installedReleaseFixture('1.0.0', 'a'),
    );
    const serialized = JSON.stringify({ summary, installed });
    expect(serialized).not.toContain('manifestSha256');
    expect(serialized).not.toContain('artifactSha256');
    expect(serialized).not.toContain('signingKeyId');
    expect(serialized).not.toContain('C:\\');
    expect(serialized).not.toContain('.tasktwin');
    expect(serialized).not.toContain('vault');
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('private');
  });

  it('has no forbidden production imports', () => {
    const sourceDirectory = fileURLToPath(new URL('../src/', import.meta.url));
    const source = readdirSync(sourceDirectory)
      .filter((fileName) => fileName.endsWith('.ts'))
      .map((fileName) => readFileSync(`${sourceDirectory}/${fileName}`, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /(?:from|import\()\s*['"](?:node:|@nestjs|@prisma|react|next|playwright)/,
    );
    expect(source).not.toContain('child_process');
    expect(source).not.toContain('filesystem');
    expect(source).not.toContain('Windows API');
  });
});
