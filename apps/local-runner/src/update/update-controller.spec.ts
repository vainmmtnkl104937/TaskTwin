import { createHash } from 'node:crypto';

import {
  ReleaseManifestSchema,
  type VerifiedRelease,
} from '@tasktwin/runner-release';
import {
  ActiveReleaseRecordSchema,
  InstalledReleaseRecordSchema,
  RunnerUpdateError,
  RunnerUpdateJournalSchema,
  assertRunnerUpdateStateTransition,
  deriveRunnerReleaseId,
  deriveRunnerUpdateId,
  type ActiveReleaseRecord,
  type RunnerReleaseId,
  type RunnerUpdateJournal,
  type RunnerUpdateState,
} from '@tasktwin/runner-update';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerifiedInstalledRelease } from './installed-release-store.js';
import { inspectInstalledRunnerState } from '../release/local-state-inspector.js';
import {
  RunnerUpdateController,
  type PreparedRunnerActivation,
  type RunnerUpdateControllerDependencies,
} from './update-controller.js';

const NOW = '2026-08-09T00:00:00.000Z';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('Runner update controller', () => {
  it('verifies twice before drain, stages, switches once, and retains source', async () => {
    const harness = createHarness();
    const result = await harness.controller.apply(fixtureFiles());

    expect(result.state).toBe('succeeded');
    expect(harness.events).toEqual([
      'verify',
      'lock',
      'verify',
      'drain',
      'stage',
      'prepare-target',
      'load-source-activation',
      'current-executable',
      'stop',
      'rebind-target',
      'active-target',
      'start',
      'health-target',
      'unlock',
    ]);
    expect(harness.removed).not.toContain(harness.source.record.releaseId);
    expect(harness.journal?.state).toBe('succeeded');
  });

  it('rejects invalid integrity before lock, journal, drain, or staging', async () => {
    const harness = createHarness();
    harness.verify.mockImplementationOnce(async () => {
      harness.events.push('verify');
      throw new RunnerUpdateError(
        'update_target_release_unverified',
        'invalid signature',
      );
    });

    await expect(
      harness.controller.apply(fixtureFiles()),
    ).rejects.toMatchObject({
      code: 'update_target_release_unverified',
    });
    expect(harness.events).toEqual(['verify']);
    expect(harness.journal).toBeNull();
  });

  it('aborts on drain timeout without staging, service stop, or cancellation', async () => {
    const harness = createHarness({ drain: 'timeout' });

    await expect(
      harness.controller.apply(fixtureFiles()),
    ).rejects.toMatchObject({
      code: 'update_drain_timeout',
    });
    expect(harness.events).not.toContain('stage');
    expect(harness.events).not.toContain('stop');
    expect(harness.events).not.toContain('cancel');
    expect(harness.journal?.state).toBe('failed_before_switch');
    expect(harness.unlocked).toBe(true);
  });

  it('restarts the verified source when a journal failure follows service stop', async () => {
    const harness = createHarness({ failTransitionTo: 'switching' });

    await expect(harness.controller.apply(fixtureFiles())).rejects.toThrow(
      'injected journal failure',
    );
    expect(harness.events).toContain('stop');
    expect(harness.events).not.toContain('rebind-target');
    expect(harness.events).toContain('ensure-running');
    expect(harness.journal?.state).toBe('failed_before_switch');
  });

  it('probes and restarts the source when stop side-effects before rejecting', async () => {
    const harness = createHarness({ stopFailsAfterSideEffect: true });

    await expect(harness.controller.apply(fixtureFiles())).rejects.toThrow(
      'injected stop failure',
    );
    expect(harness.events).not.toContain('rebind-target');
    expect(harness.events).toContain('ensure-running');
    expect(harness.journal?.state).toBe('failed_before_switch');
  });

  it('automatically rolls back and verifies the source after target health fails', async () => {
    const harness = createHarness({
      targetHealthy: false,
      includeOldRelease: true,
    });

    const result = await harness.controller.apply(fixtureFiles());

    expect(result.state).toBe('rolled_back');
    expect(harness.events).toContain('health-target');
    expect(harness.events).toContain('verify-source-proof');
    expect(harness.events).toContain('rebind-source');
    expect(harness.events).toContain('health-source');
    expect(harness.active.currentReleaseId).toBe(
      harness.source.record.releaseId,
    );
    expect(harness.journal?.state).toBe('rolled_back');
    expect(harness.removed).toContain(harness.oldRelease.record.releaseId);
  });

  it('enters manual recovery instead of launching an unreadable rollback release', async () => {
    let inspections = 0;
    const harness = createHarness({
      targetHealthy: false,
      inspectState: async () => ({
        currentLocalStateSchemaVersion: ++inspections === 1 ? 1 : 2,
        currentLocalSecretVault: null,
      }),
    });

    await expect(
      harness.controller.apply(fixtureFiles()),
    ).rejects.toMatchObject({
      code: 'update_manual_recovery_required',
    });
    expect(harness.events).not.toContain('rebind-source');
    expect(harness.journal?.state).toBe('manual_recovery_required');
  });

  it('does not change credential or native-vault bytes during a normal update', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'tasktwin-update-vault-'));
    temporaryDirectories.push(dataRoot);
    const stateRoot = join(dataRoot, '.tasktwin');
    await mkdir(stateRoot);
    const credentialPath = join(stateRoot, 'runner-credential.json');
    const vaultPath = join(stateRoot, 'local-secret-vault.v1.json');
    await writeFile(credentialPath, JSON.stringify({ schemaVersion: 1 }));
    await writeFile(
      vaultPath,
      JSON.stringify({
        schemaVersion: 1,
        masterKeyProtection: { profile: 'windows_dpapi_ng_machine_v1' },
      }),
    );
    const before = await Promise.all([
      readFile(credentialPath),
      readFile(vaultPath),
      stat(credentialPath),
      stat(vaultPath),
    ]);
    const harness = createHarness({
      dataRoot,
      inspectState: () => inspectInstalledRunnerState(dataRoot),
    });
    await harness.controller.apply(fixtureFiles());
    expect(await readFile(credentialPath)).toEqual(before[0]);
    expect(await readFile(vaultPath)).toEqual(before[1]);
    expect((await stat(credentialPath)).mtimeMs).toBe(before[2].mtimeMs);
    expect((await stat(vaultPath)).mtimeMs).toBe(before[3].mtimeMs);
  });

  it('rolls back only to the retained previous release and requires an idle Runner', async () => {
    const harness = createHarness({
      initialActive: 'target',
      initialBinding: 'target',
    });
    await expect(harness.controller.rollback()).resolves.toMatchObject({
      state: 'succeeded',
    });
    expect(harness.active.currentReleaseId).toBe(
      harness.source.record.releaseId,
    );
    expect(harness.events).not.toContain('prepare-target');

    const busy = createHarness({
      initialActive: 'target',
      initialBinding: 'target',
      drain: 'active',
    });
    await expect(busy.controller.rollback()).rejects.toMatchObject({
      code: 'update_drain_timeout',
    });
    expect(busy.events).not.toContain('stop');
  });

  it('revalidates the previous signed proof after drain and before rollback switch', async () => {
    const harness = createHarness({
      initialActive: 'target',
      initialBinding: 'target',
      failPreviousVerificationAt: 3,
    });

    await expect(harness.controller.rollback()).rejects.toMatchObject({
      code: 'update_previous_release_unverified',
    });
    expect(harness.events).not.toContain('stop');
    expect(harness.events).not.toContain('rebind-source');
    expect(harness.journal?.state).toBe('failed_before_switch');
  });

  it('recovers a pre-switch crash without changing or resuming workflow state', async () => {
    const harness = createHarness({
      initialJournalState: 'staging',
      initialActive: 'source',
      initialBinding: 'source',
    });
    await expect(harness.controller.recover()).resolves.toMatchObject({
      state: 'failed_before_switch',
    });
    expect(harness.active.currentReleaseId).toBe(
      harness.source.record.releaseId,
    );
    expect(harness.events).not.toContain('resume-workflow');
    expect(harness.events).not.toContain('stop');
    expect(harness.events).not.toContain('health-source');
    expect(harness.events).toContain('ensure-running');
    expect(harness.removed).toContain(harness.target.record.releaseId);
  });

  it('treats a mismatched active activation identity as ambiguous recovery', async () => {
    const harness = createHarness({
      initialJournalState: 'draining',
      initialActive: 'source',
      initialBinding: 'source',
      activeActivationId: 'activation_stale',
    });

    await expect(harness.controller.recover()).resolves.toMatchObject({
      state: 'manual_recovery_required',
    });
    expect(harness.events).not.toContain('ensure-running');
    expect(harness.events).not.toContain('health-source');
  });

  it('rejects recovery when the journal contradicts retained signed proof', async () => {
    const harness = createHarness({
      initialJournalState: 'draining',
      initialActive: 'source',
      initialBinding: 'source',
      journalSourceArtifactSha256: 'f'.repeat(64),
    });

    await expect(harness.controller.recover()).resolves.toMatchObject({
      state: 'manual_recovery_required',
      failureCode: 'update_journal_invalid',
    });
    expect(harness.events).not.toContain('ensure-running');
  });

  it('rejects a post-switch active pointer with the wrong previous release', async () => {
    const harness = createHarness({
      initialJournalState: 'verifying_target',
      initialActive: 'target',
      initialBinding: 'target',
      activePreviousReleaseId: null,
    });

    await expect(harness.controller.recover()).resolves.toMatchObject({
      state: 'manual_recovery_required',
    });
    expect(harness.events).not.toContain('health-target');
  });

  it('completes a clearly healthy post-switch target during recovery', async () => {
    const harness = createHarness({
      initialJournalState: 'verifying_target',
      initialActive: 'target',
      initialBinding: 'target',
    });
    await expect(harness.controller.recover()).resolves.toMatchObject({
      state: 'succeeded',
    });
    expect(harness.active.currentReleaseId).toBe(
      harness.target.record.releaseId,
    );
  });

  it('rolls back an unhealthy post-switch target and makes ambiguity manual', async () => {
    const rollback = createHarness({
      initialJournalState: 'verifying_target',
      initialActive: 'target',
      initialBinding: 'target',
      targetHealthy: false,
    });
    await expect(rollback.controller.recover()).resolves.toMatchObject({
      state: 'rolled_back',
    });
    expect(rollback.active.currentReleaseId).toBe(
      rollback.source.record.releaseId,
    );

    const ambiguous = createHarness({
      initialJournalState: 'verifying_target',
      initialActive: 'target',
      initialBinding: 'source',
    });
    await expect(ambiguous.controller.recover()).resolves.toMatchObject({
      state: 'manual_recovery_required',
    });
    expect(ambiguous.events).not.toContain('rebind-source');
  });

  it('finishes a crashed rollback by restarting and health-checking the source', async () => {
    const harness = createHarness({
      initialJournalState: 'rolling_back',
      initialActive: 'source',
      initialBinding: 'source',
    });
    await expect(harness.controller.recover()).resolves.toMatchObject({
      state: 'rolled_back',
    });
    expect(harness.events).toContain('start');
    expect(harness.events).toContain('health-source');
  });
});

function createHarness(
  options: {
    drain?: 'drained' | 'active' | 'timeout';
    targetHealthy?: boolean;
    inspectState?: RunnerUpdateControllerDependencies['inspectState'];
    initialJournalState?: RunnerUpdateState;
    initialActive?: 'source' | 'target';
    initialBinding?: 'source' | 'target';
    dataRoot?: string;
    failTransitionTo?: RunnerUpdateState;
    failPreviousVerificationAt?: number;
    stopFailsAfterSideEffect?: boolean;
    activeActivationId?: string;
    activePreviousReleaseId?: RunnerReleaseId | null;
    journalSourceArtifactSha256?: string;
    includeOldRelease?: boolean;
  } = {},
) {
  const events: string[] = [];
  const removed: string[] = [];
  const source = installedFixture('1.0.0', 'a');
  const target = installedFixture('1.1.0', 'b');
  const oldRelease = installedFixture('0.9.0', 'e');
  const initialActive = options.initialActive ?? 'source';
  let active = ActiveReleaseRecordSchema.parse({
    schemaVersion: 1,
    generation: 1,
    currentReleaseId:
      initialActive === 'source'
        ? source.record.releaseId
        : target.record.releaseId,
    previousReleaseId:
      'activePreviousReleaseId' in options
        ? options.activePreviousReleaseId
        : initialActive === 'target'
          ? source.record.releaseId
          : options.initialJournalState === 'rolling_back'
            ? target.record.releaseId
            : null,
    currentActivationId:
      options.activeActivationId ??
      (initialActive === 'source' ? 'activation_source' : 'activation_target'),
    activatedAt: NOW,
  });
  let journal: RunnerUpdateJournal | null =
    options.initialJournalState === undefined
      ? null
      : journalFixture(options.initialJournalState, source, target);
  if (journal !== null && options.journalSourceArtifactSha256 !== undefined) {
    journal = RunnerUpdateJournalSchema.parse({
      ...journal,
      sourceArtifactSha256: options.journalSourceArtifactSha256,
    });
  }
  let unlocked = false;
  let serviceExecutable =
    (options.initialBinding ?? 'source') === 'source'
      ? source.paths.activation + '/runner.exe'
      : target.paths.activation + '/runner.exe';
  const sourceActivation: PreparedRunnerActivation = {
    activationId: 'activation_source',
    serviceExecutablePath: source.paths.activation + '/runner.exe',
  };
  const targetActivation: PreparedRunnerActivation = {
    activationId: 'activation_target',
    serviceExecutablePath: target.paths.activation + '/runner.exe',
  };
  const verify = vi.fn(async () => {
    events.push('verify');
    return target.release;
  });
  let previousVerificationCount = 0;
  let transitionFailureInjected = false;
  const dependencies: RunnerUpdateControllerDependencies = {
    dataRoot: options.dataRoot ?? 'C:/TaskTwinData',
    trustedKeys: [],
    lock: {
      acquire: async () => {
        events.push('lock');
        return {
          release: async () => {
            unlocked = true;
            events.push('unlock');
          },
        };
      },
    },
    installedReleases: {
      stageAndCommit: async () => {
        events.push('stage');
        return target;
      },
      findVerified: async (releaseId) => {
        if (releaseId === source.record.releaseId) {
          previousVerificationCount += 1;
          if (
            options.failPreviousVerificationAt === previousVerificationCount
          ) {
            return null;
          }
          if (journal?.state === 'rolling_back')
            events.push('verify-source-proof');
          return source;
        }
        return releaseId === target.record.releaseId ? target : null;
      },
      listRecords: async () => [
        source.record,
        target.record,
        ...(options.includeOldRelease === true ? [oldRelease.record] : []),
      ],
      removeStaging: async () => undefined,
      removeInstalled: async (releaseId) => {
        removed.push(releaseId);
      },
    },
    activeRelease: {
      read: async () => active,
      switch: async (input) => {
        active = ActiveReleaseRecordSchema.parse({
          schemaVersion: 1,
          generation: active.generation + 1,
          currentReleaseId: input.targetReleaseId,
          previousReleaseId: active.currentReleaseId,
          currentActivationId: input.activationId,
          activatedAt: input.timestamp,
        });
        events.push(
          input.targetReleaseId === target.record.releaseId
            ? 'active-target'
            : 'active-source',
        );
        return active;
      },
    },
    journal: {
      read: async () => journal,
      begin: async (input) => {
        const { timestamp, ...journalInput } = input;
        journal = RunnerUpdateJournalSchema.parse({
          schemaVersion: 1,
          revision: 1,
          ...journalInput,
          state: 'preparing',
          startedAt: timestamp,
          updatedAt: timestamp,
        });
        return journal;
      },
      transition: async (input) => {
        if (journal === null) throw new Error('journal missing');
        if (
          !transitionFailureInjected &&
          input.state === options.failTransitionTo
        ) {
          transitionFailureInjected = true;
          throw new Error('injected journal failure');
        }
        assertRunnerUpdateStateTransition(journal.state, input.state);
        journal = RunnerUpdateJournalSchema.parse({
          ...journal,
          revision: journal.revision + 1,
          state: input.state,
          updatedAt: input.timestamp,
          ...(input.failureCode === undefined
            ? { failureCode: undefined }
            : { failureCode: input.failureCode }),
        });
        return journal;
      },
    },
    drain: {
      waitForDrain: async () => {
        events.push('drain');
        return options.drain ?? 'drained';
      },
    },
    service: {
      loadActivation: async (release) => {
        events.push(
          release.record.releaseId === source.record.releaseId
            ? 'load-source-activation'
            : 'load-target-activation',
        );
        return release.record.releaseId === source.record.releaseId
          ? sourceActivation
          : targetActivation;
      },
      prepareActivation: async () => {
        events.push('prepare-target');
        return targetActivation;
      },
      currentServiceExecutable: async () => {
        events.push('current-executable');
        return serviceExecutable;
      },
      stopAndWait: async () => {
        events.push('stop');
        if (options.stopFailsAfterSideEffect === true) {
          throw new Error('injected stop failure');
        }
      },
      ensureRunning: async () => {
        events.push('ensure-running');
      },
      rebind: async (input) => {
        serviceExecutable = input.targetPath;
        events.push(
          input.targetPath === targetActivation.serviceExecutablePath
            ? 'rebind-target'
            : 'rebind-source',
        );
      },
      startAndWait: async () => {
        events.push('start');
      },
      verifyHealth: async (input) => {
        const isTarget =
          input.installedRelease.record.releaseId === target.record.releaseId;
        events.push(isTarget ? 'health-target' : 'health-source');
        return {
          decision:
            isTarget && options.targetHealthy === false
              ? 'unhealthy'
              : 'healthy',
          reasons:
            isTarget && options.targetHealthy === false
              ? ['workflow_engine_check_failed']
              : [],
          observedVersion: input.installedRelease.record.version,
        };
      },
    },
    now: () => new Date(NOW),
    createActivationId: () => 'activation_target',
    inspectState:
      options.inspectState ??
      (async () => ({
        currentLocalStateSchemaVersion: 1,
        currentLocalSecretVault: null,
      })),
    verifyFiles: verify,
  };
  return {
    controller: new RunnerUpdateController(dependencies),
    events,
    removed,
    source,
    target,
    oldRelease,
    verify,
    get active(): ActiveReleaseRecord {
      return active;
    },
    get journal(): RunnerUpdateJournal | null {
      return journal;
    },
    get unlocked(): boolean {
      return unlocked;
    },
  };
}

function fixtureFiles() {
  return {
    manifestPath: 'C:/release/manifest.json',
    signaturePath: 'C:/release/signature.json',
    artifactPath: 'C:/release/artifact.zip',
  };
}

function journalFixture(
  state: RunnerUpdateState,
  source: VerifiedInstalledRelease,
  target: VerifiedInstalledRelease,
): RunnerUpdateJournal {
  return RunnerUpdateJournalSchema.parse({
    schemaVersion: 1,
    revision: 5,
    operation: 'apply',
    updateId: deriveRunnerUpdateId(
      {
        operation: 'apply',
        sourceManifestSha256: source.record.manifestSha256,
        targetManifestSha256: target.record.manifestSha256,
      },
      {
        sha256Hex: (value) =>
          createHash('sha256').update(value, 'utf8').digest('hex'),
      },
    ),
    state,
    sourceReleaseId: source.record.releaseId,
    targetReleaseId: target.record.releaseId,
    fromVersion: source.record.version,
    targetVersion: target.record.version,
    sourceManifestSha256: source.record.manifestSha256,
    targetManifestSha256: target.record.manifestSha256,
    sourceArtifactSha256: source.record.artifact.sha256,
    targetArtifactSha256: target.record.artifact.sha256,
    startedAt: NOW,
    updatedAt: NOW,
    ...(state === 'manual_recovery_required'
      ? { failureCode: 'update_manual_recovery_required' }
      : {}),
  });
}

function installedFixture(
  version: string,
  digestCharacter: string,
): VerifiedInstalledRelease {
  const manifestSha256 = digestCharacter.repeat(64);
  const artifactSha256 =
    digestCharacter === 'a' ? 'c'.repeat(64) : 'd'.repeat(64);
  const manifest = ReleaseManifestSchema.parse({
    schemaVersion: 1,
    product: 'tasktwin-runner',
    version,
    channel: 'stable',
    sourceCommit: digestCharacter.repeat(40),
    builtAt: NOW,
    compatibility: {
      runnerProtocolVersion: 2,
      workflowSchema: { readable: { min: 1, max: 1 } },
      localState: { readableSchemas: [1], writableSchema: 1 },
      localSecretVault: {
        readableSchemas: [1],
        writableSchema: 1,
        readableProtectionProfiles: [
          'local_secret_master_key_wrap_v1',
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
        sha256: artifactSha256,
      },
    ],
    signingKeyId: 'runner-update-test-32',
  });
  const release: VerifiedRelease = {
    manifest,
    signature: {
      schemaVersion: 1,
      algorithm: 'Ed25519',
      keyId: 'runner-update-test-32',
      manifestSha256,
      signature: 'dGVzdA',
    },
    artifact: manifest.artifacts[0]!,
    canonicalManifest: '{}',
    manifestSha256,
  };
  const record = InstalledReleaseRecordSchema.parse({
    schemaVersion: 1,
    releaseId: deriveRunnerReleaseId(manifestSha256),
    product: manifest.product,
    version,
    sourceCommit: manifest.sourceCommit,
    platform: 'windows',
    architecture: 'x64',
    signingKeyId: manifest.signingKeyId,
    manifestSha256,
    artifact: release.artifact,
    installedAt: NOW,
  });
  const root = `C:/TaskTwin/releases/${version}`;
  return {
    record,
    release,
    paths: {
      root,
      record: `${root}/installed-release.v1.json`,
      manifest: `${root}/proof/release-manifest.json`,
      signature: `${root}/proof/release-signature.json`,
      artifact: `${root}/proof/${release.artifact.fileName}`,
      payload: `${root}/payload`,
      activation: `${root}/activation`,
    },
  };
}
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
