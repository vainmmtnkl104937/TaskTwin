import { createHash, randomUUID } from 'node:crypto';

import type {
  TrustedReleaseKey,
  VerifiedRelease,
} from '@tasktwin/runner-release';
import { RUN_PROTOCOL_VERSION } from '@tasktwin/run-protocol';
import {
  RunnerUpdateError,
  createRunnerUpdatePlan,
  decideCrashRecovery,
  decideReleaseRetention,
  deriveRunnerReleaseId,
  deriveRunnerUpdateId,
  evaluateRunnerUpdatePreflight,
  evaluateRunnerInstallationCompatibility,
  evaluateRunnerRollbackCompatibility,
  summarizeRunnerUpdate,
  type ActiveReleaseRecord,
  type RunnerActivationId,
  type RunnerReleaseId,
  type RunnerTargetHealthResult,
  type RunnerUpdateErrorCode,
  type RunnerUpdateId,
  type RunnerUpdateJournal,
  type RunnerUpdateState,
  type SafeRunnerUpdateSummary,
} from '@tasktwin/runner-update';
import { WORKFLOW_SCHEMA_VERSION } from '@tasktwin/workflow-schema';

import { verifyReleaseFiles } from '../release/release-file-verifier.js';
import { inspectInstalledRunnerState } from '../release/local-state-inspector.js';
import type { RunnerUpdateLease } from './update-lock.js';
import type {
  FileInstalledReleaseStore,
  VerifiedInstalledRelease,
} from './installed-release-store.js';
import type { BeginRunnerUpdateInput } from './update-record-stores.js';

export const DEFAULT_UPDATE_DRAIN_TIMEOUT_MS = 15 * 60_000;
export const DEFAULT_TARGET_HEALTH_TIMEOUT_MS = 3 * 60_000;

export interface RunnerUpdateFileInput {
  readonly manifestPath: string;
  readonly signaturePath: string;
  readonly artifactPath: string;
}

export interface RunnerUpdateDrainCoordinator {
  waitForDrain(input: {
    readonly activationId: RunnerActivationId;
    readonly updateId: RunnerUpdateId;
    readonly timeoutMilliseconds: number;
    readonly requireInitiallyIdle: boolean;
  }): Promise<'drained' | 'active' | 'timeout'>;
}

export interface PreparedRunnerActivation {
  readonly activationId: RunnerActivationId;
  readonly serviceExecutablePath: string;
}

export interface RunnerUpdateServiceController {
  loadActivation(
    installedRelease: VerifiedInstalledRelease,
  ): Promise<PreparedRunnerActivation>;
  prepareActivation(input: {
    readonly installedRelease: VerifiedInstalledRelease;
    readonly activationId: RunnerActivationId;
    readonly requireNativeSecretAutoUnlock: boolean;
  }): Promise<PreparedRunnerActivation>;
  currentServiceExecutable(): Promise<string | null>;
  stopAndWait(): Promise<void>;
  ensureRunning(): Promise<void>;
  rebind(input: {
    readonly expectedSourcePath: string;
    readonly targetPath: string;
  }): Promise<void>;
  startAndWait(): Promise<void>;
  verifyHealth(input: {
    readonly installedRelease: VerifiedInstalledRelease;
    readonly activation: PreparedRunnerActivation;
    readonly requireNativeSecretAutoUnlock: boolean;
    readonly timeoutMilliseconds: number;
  }): Promise<RunnerTargetHealthResult>;
}

export interface RunnerUpdateControllerDependencies {
  readonly dataRoot: string;
  readonly trustedKeys: readonly TrustedReleaseKey[];
  readonly lock: { acquire(): Promise<RunnerUpdateLease> };
  readonly installedReleases: Pick<
    FileInstalledReleaseStore,
    | 'stageAndCommit'
    | 'findVerified'
    | 'listRecords'
    | 'removeStaging'
    | 'removeInstalled'
  >;
  readonly activeRelease: {
    read(): Promise<ActiveReleaseRecord | null>;
    switch(input: {
      readonly expectedCurrentReleaseId: RunnerReleaseId;
      readonly targetReleaseId: RunnerReleaseId;
      readonly activationId: RunnerActivationId;
      readonly timestamp: string;
    }): Promise<ActiveReleaseRecord>;
  };
  readonly journal: {
    read(): Promise<RunnerUpdateJournal | null>;
    begin(input: BeginRunnerUpdateInput): Promise<RunnerUpdateJournal>;
    transition(input: {
      readonly updateId: RunnerUpdateId;
      readonly state: RunnerUpdateState;
      readonly timestamp: string;
      readonly failureCode?: RunnerUpdateErrorCode;
    }): Promise<RunnerUpdateJournal>;
  };
  readonly drain: RunnerUpdateDrainCoordinator;
  readonly service: RunnerUpdateServiceController;
  readonly now?: () => Date;
  readonly createActivationId?: () => RunnerActivationId;
  readonly inspectState?: typeof inspectInstalledRunnerState;
  readonly verifyFiles?: typeof verifyReleaseFiles;
}

export interface RunnerUpdateApplyResult {
  readonly state: 'succeeded' | 'rolled_back';
  readonly summary: SafeRunnerUpdateSummary;
}

export class RunnerUpdateController {
  private readonly now: () => Date;
  private readonly createActivationId: () => RunnerActivationId;
  private readonly inspectState: typeof inspectInstalledRunnerState;
  private readonly verifyFiles: typeof verifyReleaseFiles;

  constructor(
    private readonly dependencies: RunnerUpdateControllerDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.createActivationId =
      dependencies.createActivationId ??
      (() =>
        `activation_${randomUUID().replaceAll('-', '')}` as RunnerActivationId);
    this.inspectState =
      dependencies.inspectState ?? inspectInstalledRunnerState;
    this.verifyFiles = dependencies.verifyFiles ?? verifyReleaseFiles;
  }

  async status(): Promise<{
    readonly activeRelease: ActiveReleaseRecord | null;
    readonly update: SafeRunnerUpdateSummary | null;
  }> {
    const [activeRelease, journal] = await Promise.all([
      this.dependencies.activeRelease.read(),
      this.dependencies.journal.read(),
    ]);
    return {
      activeRelease,
      update: journal === null ? null : summarizeRunnerUpdate(journal),
    };
  }

  async apply(
    files: RunnerUpdateFileInput,
    options: {
      readonly drainTimeoutMilliseconds?: number;
      readonly healthTimeoutMilliseconds?: number;
    } = {},
  ): Promise<RunnerUpdateApplyResult> {
    // This first verification is intentionally before the updater lock creates
    // any installation state and before maintenance can affect job admission.
    const initialTarget = await this.verifyTarget(files);
    const lease = await this.dependencies.lock.acquire();
    let updateId: RunnerUpdateId | null = null;
    let target: VerifiedInstalledRelease | null = null;
    let switched = false;
    let serviceRebound = false;
    let sourceServiceStopped = false;
    let rollbackInput:
      | Parameters<RunnerUpdateController['rollbackAfterFailedTarget']>[0]
      | null = null;
    try {
      const targetAgain = await this.verifyTarget(files);
      assertSameRelease(initialTarget, targetAgain);
      const context = await this.loadVerifiedCurrent();
      const state = await this.inspectState(this.dependencies.dataRoot);
      const preflight = evaluateRunnerUpdatePreflight({
        currentRelease: context.current.release.manifest,
        targetRelease: targetAgain.manifest,
        ...state,
        platform: targetAgain.artifact.platform,
        architecture: targetAgain.artifact.architecture,
      });
      if (preflight.decision !== 'allowed') {
        throw preflightError(preflight.reasons);
      }
      const installationCompatibility = evaluateRunnerInstallationCompatibility(
        {
          currentRelease: context.current.release.manifest,
          targetRelease: targetAgain.manifest,
          supportedRunnerProtocolVersions: [RUN_PROTOCOL_VERSION],
          requiredWorkflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
          currentServiceStateSchemaVersion:
            state.currentLocalStateSchemaVersion,
        },
      );
      const nativeUnlockRequired =
        state.currentLocalSecretVault?.protectionProfile ===
        'windows_dpapi_ng_machine_v1';
      const plan = createRunnerUpdatePlan(
        {
          preflight,
          installationCompatibility,
          platform: targetAgain.artifact.platform,
          architecture: targetAgain.artifact.architecture,
          sourceManifestSha256: context.current.release.manifestSha256,
          targetManifestSha256: targetAgain.manifestSha256,
          sourceArtifactSha256: context.current.record.artifact.sha256,
          targetArtifactSha256: targetAgain.artifact.sha256,
          requireNativeSecretAutoUnlock: nativeUnlockRequired,
        },
        nodeUpdateHasher,
      );
      updateId = plan.updateId;
      const timestamp = this.timestamp();
      await this.dependencies.journal.begin({
        operation: 'apply',
        updateId,
        sourceReleaseId: context.current.record.releaseId,
        targetReleaseId: deriveRunnerReleaseId(targetAgain.manifestSha256),
        fromVersion: context.current.record.version,
        targetVersion: targetAgain.manifest.version,
        sourceManifestSha256: context.current.record.manifestSha256,
        targetManifestSha256: targetAgain.manifestSha256,
        sourceArtifactSha256: context.current.record.artifact.sha256,
        targetArtifactSha256: targetAgain.artifact.sha256,
        timestamp,
      });
      await this.transition(updateId, 'draining');
      const drain = await this.dependencies.drain.waitForDrain({
        activationId: context.active.currentActivationId,
        updateId,
        timeoutMilliseconds:
          options.drainTimeoutMilliseconds ?? DEFAULT_UPDATE_DRAIN_TIMEOUT_MS,
        requireInitiallyIdle: false,
      });
      if (drain !== 'drained') {
        await this.failBeforeSwitch(updateId, 'update_drain_timeout');
        throw new RunnerUpdateError(
          'update_drain_timeout',
          'The active WorkflowRun did not drain before the update deadline.',
        );
      }

      await this.transition(updateId, 'staging');
      target = await this.dependencies.installedReleases.stageAndCommit({
        updateId,
        verifiedRelease: targetAgain,
        ...files,
        installedAt: this.timestamp(),
      });
      const targetActivation =
        await this.dependencies.service.prepareActivation({
          installedRelease: target,
          activationId: this.createActivationId(),
          requireNativeSecretAutoUnlock: nativeUnlockRequired,
        });
      const sourceActivation = await this.dependencies.service.loadActivation(
        context.current,
      );
      if (
        sourceActivation.activationId !== context.active.currentActivationId
      ) {
        throw new RunnerUpdateError(
          'update_service_switch_failed',
          'The active release and service activation identities differ.',
        );
      }
      await this.transition(updateId, 'ready_to_switch');
      rollbackInput = {
        updateId,
        source: context.current,
        sourceActivation,
        target,
        targetActivation,
        nativeUnlockRequired,
        healthTimeoutMilliseconds:
          options.healthTimeoutMilliseconds ?? DEFAULT_TARGET_HEALTH_TIMEOUT_MS,
      };
      await this.assertCurrentServiceExecutable(
        sourceActivation.serviceExecutablePath,
      );
      sourceServiceStopped = true;
      await this.dependencies.service.stopAndWait();
      await this.transition(updateId, 'switching');
      await this.dependencies.service.rebind({
        expectedSourcePath: sourceActivation.serviceExecutablePath,
        targetPath: targetActivation.serviceExecutablePath,
      });
      serviceRebound = true;
      await this.dependencies.activeRelease.switch({
        expectedCurrentReleaseId: context.current.record.releaseId,
        targetReleaseId: target.record.releaseId,
        activationId: targetActivation.activationId,
        timestamp: this.timestamp(),
      });
      switched = true;
      await this.transition(updateId, 'starting_target');
      await this.dependencies.service.startAndWait();
      await this.transition(updateId, 'verifying_target');
      const health = await this.dependencies.service.verifyHealth({
        installedRelease: target,
        activation: targetActivation,
        requireNativeSecretAutoUnlock: nativeUnlockRequired,
        timeoutMilliseconds:
          options.healthTimeoutMilliseconds ?? DEFAULT_TARGET_HEALTH_TIMEOUT_MS,
      });
      if (health.decision !== 'healthy') {
        return await this.rollbackAfterFailedTarget(rollbackInput);
      }
      const journal = await this.transition(updateId, 'succeeded');
      await this.applyRetention();
      return { state: 'succeeded', summary: summarizeRunnerUpdate(journal) };
    } catch (error: unknown) {
      if (updateId !== null) {
        const journal = await this.dependencies.journal
          .read()
          .catch(() => null);
        if (
          switched &&
          rollbackInput !== null &&
          journal?.updateId === updateId &&
          ['switching', 'starting_target', 'verifying_target'].includes(
            journal.state,
          )
        ) {
          return await this.rollbackAfterFailedTarget(rollbackInput);
        }
        if (
          !serviceRebound &&
          !switched &&
          sourceServiceStopped &&
          rollbackInput !== null
        ) {
          const observed = await this.dependencies.service
            .currentServiceExecutable()
            .catch(() => null);
          if (
            observed?.toLowerCase() ===
            rollbackInput.targetActivation.serviceExecutablePath.toLowerCase()
          ) {
            serviceRebound = true;
          } else if (
            observed?.toLowerCase() ===
            rollbackInput.sourceActivation.serviceExecutablePath.toLowerCase()
          ) {
            const restarted = await this.dependencies.service
              .ensureRunning()
              .then(() => true)
              .catch(() => false);
            sourceServiceStopped = !restarted;
            if (!restarted) serviceRebound = true;
          } else {
            serviceRebound = true;
          }
        }
        if (serviceRebound && !switched && journal?.updateId === updateId) {
          await this.transition(
            updateId,
            'manual_recovery_required',
            'update_recovery_ambiguous',
          ).catch(() => undefined);
          throw new RunnerUpdateError(
            'update_manual_recovery_required',
            'The service binding changed without an atomic active-release commit.',
          );
        }
        if (
          journal?.updateId === updateId &&
          !switched &&
          ![
            'failed_before_switch',
            'manual_recovery_required',
            'succeeded',
            'rolled_back',
          ].includes(journal.state)
        ) {
          await this.failBeforeSwitch(updateId, updateErrorCode(error)).catch(
            () => undefined,
          );
        }
        await this.dependencies.installedReleases
          .removeStaging(updateId)
          .catch(() => undefined);
        if (!switched && target !== null) {
          await this.dependencies.installedReleases
            .removeInstalled(target.record.releaseId)
            .catch(() => undefined);
        }
      }
      throw error;
    } finally {
      await releaseLease(lease);
    }
  }

  async rollback(
    options: {
      readonly healthTimeoutMilliseconds?: number;
    } = {},
  ): Promise<RunnerUpdateApplyResult> {
    let context = await this.loadVerifiedCurrent();
    if (context.active.previousReleaseId === null) {
      throw new RunnerUpdateError(
        'update_previous_release_unverified',
        'There is no retained previous release to roll back to.',
      );
    }
    let previous = await this.dependencies.installedReleases.findVerified(
      context.active.previousReleaseId,
    );
    if (previous === null) {
      throw new RunnerUpdateError(
        'update_previous_release_unverified',
        'The previous release proof is unavailable.',
      );
    }
    const lease = await this.dependencies.lock.acquire();
    let updateId: RunnerUpdateId | null = null;
    try {
      const lockedContext = await this.loadVerifiedCurrent();
      if (
        lockedContext.active.generation !== context.active.generation ||
        lockedContext.active.currentReleaseId !==
          context.active.currentReleaseId ||
        lockedContext.active.previousReleaseId !==
          context.active.previousReleaseId
      ) {
        throw new RunnerUpdateError(
          'update_already_in_progress',
          'The active release changed while rollback was being prepared.',
        );
      }
      const lockedPrevious =
        await this.dependencies.installedReleases.findVerified(
          previous.record.releaseId,
        );
      if (lockedPrevious === null) {
        throw new RunnerUpdateError(
          'update_previous_release_unverified',
          'The previous release proof changed while rollback was being prepared.',
        );
      }
      context = lockedContext;
      previous = lockedPrevious;
      let state = await this.inspectState(this.dependencies.dataRoot);
      assertCompatibleRollback(
        context.current.release,
        previous.release,
        state,
      );
      updateId = deriveRunnerUpdateId(
        {
          operation: 'manual_rollback',
          sourceManifestSha256: context.current.release.manifestSha256,
          targetManifestSha256: previous.release.manifestSha256,
        },
        nodeUpdateHasher,
      );
      await this.dependencies.journal.begin({
        operation: 'manual_rollback',
        updateId,
        sourceReleaseId: context.current.record.releaseId,
        targetReleaseId: previous.record.releaseId,
        fromVersion: context.current.record.version,
        targetVersion: previous.record.version,
        sourceManifestSha256: context.current.record.manifestSha256,
        targetManifestSha256: previous.record.manifestSha256,
        sourceArtifactSha256: context.current.record.artifact.sha256,
        targetArtifactSha256: previous.record.artifact.sha256,
        timestamp: this.timestamp(),
      });
      await this.transition(updateId, 'draining');
      const drain = await this.dependencies.drain.waitForDrain({
        activationId: context.active.currentActivationId,
        updateId,
        timeoutMilliseconds: 1_000,
        requireInitiallyIdle: true,
      });
      if (drain !== 'drained') {
        await this.failBeforeSwitch(updateId, 'update_drain_timeout');
        throw new RunnerUpdateError(
          'update_drain_timeout',
          'Manual rollback requires an idle Runner.',
        );
      }

      // A rollback target may have changed while the Runner was draining. Re-read
      // the active pointer, both signed installed proofs, and persisted schema
      // facts at the last safe point before any service mutation.
      const immediateContext = await this.loadVerifiedCurrent();
      if (
        immediateContext.active.generation !== context.active.generation ||
        immediateContext.active.currentReleaseId !==
          context.active.currentReleaseId ||
        immediateContext.active.previousReleaseId !==
          context.active.previousReleaseId
      ) {
        throw new RunnerUpdateError(
          'update_already_in_progress',
          'The active release changed while the Runner was draining.',
        );
      }
      const immediatePrevious =
        await this.dependencies.installedReleases.findVerified(
          previous.record.releaseId,
        );
      if (immediatePrevious === null) {
        throw new RunnerUpdateError(
          'update_previous_release_unverified',
          'The previous release proof changed while the Runner was draining.',
        );
      }
      assertSameInstalledRelease(context.current, immediateContext.current);
      assertSameInstalledRelease(previous, immediatePrevious);
      state = await this.inspectState(this.dependencies.dataRoot);
      assertCompatibleRollback(
        immediateContext.current.release,
        immediatePrevious.release,
        state,
      );
      context = immediateContext;
      previous = immediatePrevious;
      await this.transition(updateId, 'staging');
      const nativeUnlockRequired =
        state.currentLocalSecretVault?.protectionProfile ===
        'windows_dpapi_ng_machine_v1';
      const targetActivation =
        await this.dependencies.service.loadActivation(previous);
      const currentActivation = await this.dependencies.service.loadActivation(
        context.current,
      );
      if (
        currentActivation.activationId !== context.active.currentActivationId
      ) {
        throw new RunnerUpdateError(
          'update_service_switch_failed',
          'The active release and service activation identities differ.',
        );
      }
      await this.transition(updateId, 'ready_to_switch');
      return await this.switchForManualRollback({
        updateId,
        source: context.current,
        sourceActivation: currentActivation,
        target: previous,
        targetActivation,
        nativeUnlockRequired,
        healthTimeoutMilliseconds:
          options.healthTimeoutMilliseconds ?? DEFAULT_TARGET_HEALTH_TIMEOUT_MS,
      });
    } catch (error: unknown) {
      if (updateId !== null) {
        const journal = await this.dependencies.journal
          .read()
          .catch(() => null);
        if (
          journal?.updateId === updateId &&
          ['preparing', 'draining', 'staging', 'ready_to_switch'].includes(
            journal.state,
          )
        ) {
          await this.failBeforeSwitch(updateId, updateErrorCode(error)).catch(
            () => undefined,
          );
        }
        await this.dependencies.installedReleases
          .removeStaging(updateId)
          .catch(() => undefined);
      }
      throw error;
    } finally {
      await releaseLease(lease);
    }
  }

  async recover(
    options: {
      readonly healthTimeoutMilliseconds?: number;
    } = {},
  ): Promise<SafeRunnerUpdateSummary | null> {
    const lease = await this.dependencies.lock.acquire();
    try {
      const journal = await this.dependencies.journal.read();
      if (journal === null) return null;
      if (
        ['idle', 'succeeded', 'failed_before_switch', 'rolled_back'].includes(
          journal.state,
        )
      ) {
        return summarizeRunnerUpdate(journal);
      }
      if (journal.state === 'manual_recovery_required') {
        throw new RunnerUpdateError(
          'update_manual_recovery_required',
          'The installation already requires manual recovery.',
        );
      }

      const [active, source, target] = await Promise.all([
        this.dependencies.activeRelease.read(),
        this.dependencies.installedReleases.findVerified(
          journal.sourceReleaseId,
        ),
        this.dependencies.installedReleases.findVerified(
          journal.targetReleaseId,
        ),
      ]);
      if (active === null || source === null) {
        return await this.enterManualRecovery(
          journal.updateId,
          'update_previous_release_unverified',
        );
      }
      if (!journalMatchesVerifiedProofs(journal, source, target)) {
        return await this.enterManualRecovery(
          journal.updateId,
          'update_journal_invalid',
        );
      }
      const sourceActivation = await this.dependencies.service
        .loadActivation(source)
        .catch(() => null);
      const targetActivation =
        target === null
          ? null
          : await this.dependencies.service
              .loadActivation(target)
              .catch(() => null);
      if (sourceActivation === null) {
        return await this.enterManualRecovery(
          journal.updateId,
          'update_previous_release_unverified',
        );
      }
      const currentExecutable = await this.dependencies.service
        .currentServiceExecutable()
        .catch(() => null);
      const observed = observedServiceRelease({
        active,
        sourceReleaseId: source.record.releaseId,
        targetReleaseId: target?.record.releaseId ?? journal.targetReleaseId,
        currentExecutable,
        sourceExecutable: sourceActivation.serviceExecutablePath,
        targetExecutable: targetActivation?.serviceExecutablePath ?? null,
        sourceActivationId: sourceActivation.activationId,
        targetActivationId: targetActivation?.activationId ?? null,
        expectedTargetPreviousReleaseId: journal.sourceReleaseId,
        expectedSourcePreviousReleaseId:
          journal.state === 'rolling_back' ? journal.targetReleaseId : null,
      });
      const safelyPreSwitch =
        ['preparing', 'draining', 'staging', 'ready_to_switch'].includes(
          journal.state,
        ) ||
        (journal.state === 'switching' && observed === 'source');
      if (safelyPreSwitch) {
        if (observed !== 'source') {
          return await this.enterManualRecovery(
            journal.updateId,
            'update_recovery_ambiguous',
          );
        }
        await this.dependencies.installedReleases
          .removeStaging(journal.updateId)
          .catch(() => undefined);
        if (
          journal.operation === 'apply' &&
          target !== null &&
          target.record.releaseId !== active.currentReleaseId &&
          target.record.releaseId !== active.previousReleaseId
        ) {
          await this.dependencies.installedReleases
            .removeInstalled(target.record.releaseId)
            .catch(() => undefined);
        }
        const sourceAvailable = await this.dependencies.service
          .ensureRunning()
          .then(() => true)
          .catch(() => false);
        if (!sourceAvailable) {
          return await this.enterManualRecovery(
            journal.updateId,
            'update_service_switch_failed',
          );
        }
        const failed = await this.failBeforeSwitch(
          journal.updateId,
          journal.failureCode ?? 'update_staging_failed',
        );
        return summarizeRunnerUpdate(failed);
      }
      const state = await this.inspectState(this.dependencies.dataRoot).catch(
        () => null,
      );
      const rollbackSafety =
        target === null || state === null
          ? 'unknown'
          : isCompatibleRollback(target.release, source.release, state)
            ? 'safe'
            : 'unsafe';
      const nativeUnlockRequired =
        state?.currentLocalSecretVault?.protectionProfile ===
        'windows_dpapi_ng_machine_v1';
      const healthTimeoutMilliseconds =
        options.healthTimeoutMilliseconds ?? DEFAULT_TARGET_HEALTH_TIMEOUT_MS;
      if (journal.state === 'rolling_back' && observed === 'source') {
        await this.dependencies.service.startAndWait().catch(() => undefined);
      }
      const targetHealth =
        observed === 'target' && target !== null && targetActivation !== null
          ? (
              await this.dependencies.service.verifyHealth({
                installedRelease: target,
                activation: targetActivation,
                requireNativeSecretAutoUnlock: nativeUnlockRequired,
                timeoutMilliseconds: healthTimeoutMilliseconds,
              })
            ).decision
          : 'unhealthy';
      const sourceHealth =
        observed === 'source'
          ? (
              await this.dependencies.service.verifyHealth({
                installedRelease: source,
                activation: sourceActivation,
                requireNativeSecretAutoUnlock: nativeUnlockRequired,
                timeoutMilliseconds: healthTimeoutMilliseconds,
              })
            ).decision
          : 'unhealthy';
      const decision = decideCrashRecovery({
        journal,
        observedServiceRelease: observed,
        targetHealth,
        sourceHealth,
        rollbackSafety,
      });

      switch (decision.action) {
        case 'no_action':
          return summarizeRunnerUpdate(journal);
        case 'fail_before_switch': {
          await this.dependencies.installedReleases
            .removeStaging(journal.updateId)
            .catch(() => undefined);
          if (target !== null) {
            await this.dependencies.installedReleases
              .removeInstalled(target.record.releaseId)
              .catch(() => undefined);
          }
          await this.dependencies.service
            .ensureRunning()
            .catch(() => undefined);
          const failed = await this.failBeforeSwitch(
            journal.updateId,
            'update_staging_failed',
          );
          return summarizeRunnerUpdate(failed);
        }
        case 'complete_target': {
          const completed = await this.completeRecoveredTarget(
            journal.updateId,
          );
          await this.applyRetention();
          return summarizeRunnerUpdate(completed);
        }
        case 'resume_target_verification': {
          if (target === null || targetActivation === null) {
            return this.enterManualRecovery(
              journal.updateId,
              'update_recovery_ambiguous',
            );
          }
          await this.advanceToVerifyingTarget(journal.updateId);
          const health = await this.dependencies.service.verifyHealth({
            installedRelease: target,
            activation: targetActivation,
            requireNativeSecretAutoUnlock: nativeUnlockRequired,
            timeoutMilliseconds: healthTimeoutMilliseconds,
          });
          if (health.decision === 'healthy') {
            const completed = await this.transition(
              journal.updateId,
              'succeeded',
            );
            return summarizeRunnerUpdate(completed);
          }
          if (rollbackSafety !== 'safe') {
            return this.enterManualRecovery(
              journal.updateId,
              'update_rollback_unproven',
            );
          }
          return (
            await this.rollbackAfterFailedTarget({
              updateId: journal.updateId,
              source,
              sourceActivation,
              target,
              targetActivation,
              nativeUnlockRequired,
              healthTimeoutMilliseconds,
            })
          ).summary;
        }
        case 'begin_rollback':
        case 'retry_rollback': {
          if (
            target === null ||
            targetActivation === null ||
            rollbackSafety !== 'safe'
          ) {
            return this.enterManualRecovery(
              journal.updateId,
              'update_rollback_unproven',
            );
          }
          return (
            await this.rollbackAfterFailedTarget(
              {
                updateId: journal.updateId,
                source,
                sourceActivation,
                target,
                targetActivation,
                nativeUnlockRequired,
                healthTimeoutMilliseconds,
              },
              decision.action === 'retry_rollback',
            )
          ).summary;
        }
        case 'complete_rollback': {
          const completed = await this.transition(
            journal.updateId,
            'rolled_back',
            journal.failureCode ?? 'update_target_health_failed',
          );
          await this.applyRetention();
          return summarizeRunnerUpdate(completed);
        }
        case 'manual_recovery':
          return this.enterManualRecovery(
            journal.updateId,
            'update_recovery_ambiguous',
          );
      }
    } finally {
      await releaseLease(lease);
    }
  }

  private async switchForManualRollback(input: {
    updateId: RunnerUpdateId;
    source: VerifiedInstalledRelease;
    sourceActivation: PreparedRunnerActivation;
    target: VerifiedInstalledRelease;
    targetActivation: PreparedRunnerActivation;
    nativeUnlockRequired: boolean;
    healthTimeoutMilliseconds: number;
  }): Promise<RunnerUpdateApplyResult> {
    // A retained activation host is the only legal manual rollback target.
    let rebound = false;
    let switched = false;
    let sourceServiceStopped = false;
    try {
      await this.assertCurrentServiceExecutable(
        input.sourceActivation.serviceExecutablePath,
      );
      sourceServiceStopped = true;
      await this.dependencies.service.stopAndWait();
      await this.transition(input.updateId, 'switching');
      await this.dependencies.service.rebind({
        expectedSourcePath: input.sourceActivation.serviceExecutablePath,
        targetPath: input.targetActivation.serviceExecutablePath,
      });
      rebound = true;
      await this.dependencies.activeRelease.switch({
        expectedCurrentReleaseId: input.source.record.releaseId,
        targetReleaseId: input.target.record.releaseId,
        activationId: input.targetActivation.activationId,
        timestamp: this.timestamp(),
      });
      switched = true;
      await this.transition(input.updateId, 'starting_target');
      await this.dependencies.service.startAndWait();
      await this.transition(input.updateId, 'verifying_target');
      const health = await this.dependencies.service.verifyHealth({
        installedRelease: input.target,
        activation: input.targetActivation,
        requireNativeSecretAutoUnlock: input.nativeUnlockRequired,
        timeoutMilliseconds: input.healthTimeoutMilliseconds,
      });
      if (health.decision !== 'healthy') {
        return this.rollbackAfterFailedTarget(input);
      }
      const journal = await this.transition(input.updateId, 'succeeded');
      await this.applyRetention();
      return { state: 'succeeded', summary: summarizeRunnerUpdate(journal) };
    } catch (error: unknown) {
      const journal = await this.dependencies.journal.read().catch(() => null);
      if (
        switched &&
        journal !== null &&
        ['switching', 'starting_target', 'verifying_target'].includes(
          journal.state,
        )
      ) {
        return this.rollbackAfterFailedTarget(input);
      }
      if (!rebound && journal?.state === 'switching') {
        const observed = await this.dependencies.service
          .currentServiceExecutable()
          .catch(() => null);
        if (
          observed?.toLowerCase() ===
          input.targetActivation.serviceExecutablePath.toLowerCase()
        ) {
          rebound = true;
        } else if (
          observed?.toLowerCase() ===
          input.sourceActivation.serviceExecutablePath.toLowerCase()
        ) {
          const restarted = await this.dependencies.service
            .ensureRunning()
            .then(() => true)
            .catch(() => false);
          sourceServiceStopped = !restarted;
          if (!restarted) rebound = true;
        } else {
          rebound = true;
        }
      }
      if (!rebound && !switched && sourceServiceStopped) {
        const observed = await this.dependencies.service
          .currentServiceExecutable()
          .catch(() => null);
        if (
          observed?.toLowerCase() ===
          input.sourceActivation.serviceExecutablePath.toLowerCase()
        ) {
          const restarted = await this.dependencies.service
            .ensureRunning()
            .then(() => true)
            .catch(() => false);
          sourceServiceStopped = !restarted;
          if (!restarted) rebound = true;
        } else {
          rebound = true;
        }
      }
      if (rebound) {
        await this.transition(
          input.updateId,
          'manual_recovery_required',
          'update_recovery_ambiguous',
        ).catch(() => undefined);
        throw new RunnerUpdateError(
          'update_manual_recovery_required',
          'The service binding changed without an active-release commit.',
        );
      }
      await this.dependencies.service.ensureRunning().catch(() => undefined);
      await this.failBeforeSwitch(input.updateId, updateErrorCode(error)).catch(
        () => undefined,
      );
      throw error;
    }
  }

  private async rollbackAfterFailedTarget(
    input: {
      updateId: RunnerUpdateId;
      source: VerifiedInstalledRelease;
      sourceActivation: PreparedRunnerActivation;
      target: VerifiedInstalledRelease;
      targetActivation: PreparedRunnerActivation;
      nativeUnlockRequired: boolean;
      healthTimeoutMilliseconds: number;
    },
    alreadyRolling = false,
  ): Promise<RunnerUpdateApplyResult> {
    if (!alreadyRolling) {
      await this.transition(
        input.updateId,
        'rolling_back',
        'update_target_health_failed',
      );
    }
    try {
      const verifiedSource =
        await this.dependencies.installedReleases.findVerified(
          input.source.record.releaseId,
        );
      if (verifiedSource === null) throw new Error('source proof');
      const state = await this.inspectState(this.dependencies.dataRoot);
      assertCompatibleRollback(
        input.target.release,
        verifiedSource.release,
        state,
      );
      await this.dependencies.service.stopAndWait().catch(() => undefined);
      await this.dependencies.service.rebind({
        expectedSourcePath: input.targetActivation.serviceExecutablePath,
        targetPath: input.sourceActivation.serviceExecutablePath,
      });
      await this.dependencies.activeRelease.switch({
        expectedCurrentReleaseId: input.target.record.releaseId,
        targetReleaseId: verifiedSource.record.releaseId,
        activationId: input.sourceActivation.activationId,
        timestamp: this.timestamp(),
      });
      await this.dependencies.service.startAndWait();
      const sourceHealth = await this.dependencies.service.verifyHealth({
        installedRelease: verifiedSource,
        activation: input.sourceActivation,
        requireNativeSecretAutoUnlock: input.nativeUnlockRequired,
        timeoutMilliseconds: input.healthTimeoutMilliseconds,
      });
      if (sourceHealth.decision !== 'healthy') throw new Error('source health');
      const journal = await this.transition(
        input.updateId,
        'rolled_back',
        'update_target_health_failed',
      );
      await this.applyRetention();
      return { state: 'rolled_back', summary: summarizeRunnerUpdate(journal) };
    } catch {
      await this.transition(
        input.updateId,
        'manual_recovery_required',
        'update_manual_recovery_required',
      ).catch(() => undefined);
      throw new RunnerUpdateError(
        'update_manual_recovery_required',
        'Automatic rollback could not be proven safe.',
      );
    }
  }

  private async loadVerifiedCurrent(): Promise<{
    active: ActiveReleaseRecord;
    current: VerifiedInstalledRelease;
  }> {
    const active = await this.dependencies.activeRelease.read();
    if (active === null) {
      throw new RunnerUpdateError(
        'update_current_release_unverified',
        'This installation has no verified active-release record.',
      );
    }
    const current = await this.dependencies.installedReleases.findVerified(
      active.currentReleaseId,
    );
    if (current === null) {
      throw new RunnerUpdateError(
        'update_current_release_unverified',
        'The active Runner release proof is unavailable.',
      );
    }
    return { active, current };
  }

  private async completeRecoveredTarget(updateId: RunnerUpdateId) {
    await this.advanceToVerifyingTarget(updateId);
    const current = await this.dependencies.journal.read();
    if (current?.state === 'succeeded') return current;
    return this.transition(updateId, 'succeeded');
  }

  private async advanceToVerifyingTarget(
    updateId: RunnerUpdateId,
  ): Promise<void> {
    let current = await this.dependencies.journal.read();
    if (current?.updateId !== updateId) {
      throw new RunnerUpdateError(
        'update_journal_invalid',
        'The recovery journal identity changed unexpectedly.',
      );
    }
    if (current.state === 'switching') {
      current = await this.transition(updateId, 'starting_target');
    }
    if (current.state === 'starting_target') {
      await this.transition(updateId, 'verifying_target');
    }
  }

  private async enterManualRecovery(
    updateId: RunnerUpdateId,
    code: RunnerUpdateErrorCode,
  ): Promise<SafeRunnerUpdateSummary> {
    const current = await this.dependencies.journal.read();
    if (current?.state === 'manual_recovery_required') {
      return summarizeRunnerUpdate(current);
    }
    const journal = await this.transition(
      updateId,
      'manual_recovery_required',
      code,
    );
    return summarizeRunnerUpdate(journal);
  }

  private verifyTarget(files: RunnerUpdateFileInput): Promise<VerifiedRelease> {
    return this.verifyFiles({
      ...files,
      trustedKeys: this.dependencies.trustedKeys,
    });
  }

  private async assertCurrentServiceExecutable(
    expected: string,
  ): Promise<void> {
    const observed = await this.dependencies.service.currentServiceExecutable();
    if (
      observed === null ||
      observed.toLowerCase() !== expected.toLowerCase()
    ) {
      throw new RunnerUpdateError(
        'update_service_switch_failed',
        'The Windows service is not bound to the verified active release.',
      );
    }
  }

  private transition(
    updateId: RunnerUpdateId,
    state: RunnerUpdateState,
    failureCode?: RunnerUpdateErrorCode,
  ) {
    return this.dependencies.journal.transition({
      updateId,
      state,
      timestamp: this.timestamp(),
      ...(failureCode === undefined ? {} : { failureCode }),
    });
  }

  private failBeforeSwitch(
    updateId: RunnerUpdateId,
    code: RunnerUpdateErrorCode,
  ) {
    return this.transition(updateId, 'failed_before_switch', code);
  }

  private async applyRetention(): Promise<void> {
    const [installedReleases, activeRelease, journal] = await Promise.all([
      this.dependencies.installedReleases.listRecords(),
      this.dependencies.activeRelease.read(),
      this.dependencies.journal.read(),
    ]);
    if (activeRelease === null) return;
    const decision = decideReleaseRetention({
      installedReleases,
      activeRelease,
      journal,
    });
    for (const releaseId of decision.removeReleaseIds) {
      await this.dependencies.installedReleases.removeInstalled(releaseId);
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function assertCompatibleRollback(
  current: VerifiedRelease,
  target: VerifiedRelease,
  state: Awaited<ReturnType<typeof inspectInstalledRunnerState>>,
): void {
  if (!isCompatibleRollback(current, target, state)) {
    throw new RunnerUpdateError(
      'update_rollback_compatibility_failed',
      'The previous release cannot safely read current persisted state.',
    );
  }
}

function isCompatibleRollback(
  current: VerifiedRelease,
  target: VerifiedRelease,
  state: Awaited<ReturnType<typeof inspectInstalledRunnerState>>,
): boolean {
  const result = evaluateRunnerRollbackCompatibility({
    currentVersion: current.manifest.version,
    rollbackRelease: target.manifest,
    ...state,
    platform: target.artifact.platform,
    architecture: target.artifact.architecture,
  });
  const installation = evaluateRunnerInstallationCompatibility({
    currentRelease: current.manifest,
    targetRelease: target.manifest,
    supportedRunnerProtocolVersions: [RUN_PROTOCOL_VERSION],
    requiredWorkflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    currentServiceStateSchemaVersion: state.currentLocalStateSchemaVersion,
  });
  return result.decision === 'safe' && installation.decision === 'compatible';
}

function observedServiceRelease(input: {
  active: ActiveReleaseRecord;
  sourceReleaseId: string;
  targetReleaseId: string;
  currentExecutable: string | null;
  sourceExecutable: string;
  targetExecutable: string | null;
  sourceActivationId: string;
  targetActivationId: string | null;
  expectedTargetPreviousReleaseId: string;
  expectedSourcePreviousReleaseId: string | null;
}): 'source' | 'target' | 'neither' | 'ambiguous' {
  if (input.currentExecutable === null) return 'neither';
  const current = input.currentExecutable.toLowerCase();
  const serviceSource = current === input.sourceExecutable.toLowerCase();
  const serviceTarget =
    input.targetExecutable !== null &&
    current === input.targetExecutable.toLowerCase();
  const activeSource =
    input.active.currentReleaseId === input.sourceReleaseId &&
    input.active.currentActivationId === input.sourceActivationId &&
    (input.expectedSourcePreviousReleaseId === null ||
      input.active.previousReleaseId === input.expectedSourcePreviousReleaseId);
  const activeTarget =
    input.active.currentReleaseId === input.targetReleaseId &&
    input.targetActivationId !== null &&
    input.active.currentActivationId === input.targetActivationId &&
    input.active.previousReleaseId === input.expectedTargetPreviousReleaseId;
  if (serviceSource && activeSource) return 'source';
  if (serviceTarget && activeTarget) return 'target';
  if (!serviceSource && !serviceTarget && !activeSource && !activeTarget) {
    return 'neither';
  }
  return 'ambiguous';
}

function journalMatchesVerifiedProofs(
  journal: RunnerUpdateJournal,
  source: VerifiedInstalledRelease,
  target: VerifiedInstalledRelease | null,
): boolean {
  if (
    journal.sourceReleaseId !== source.record.releaseId ||
    journal.fromVersion !== source.record.version ||
    journal.sourceManifestSha256 !== source.record.manifestSha256 ||
    journal.sourceArtifactSha256 !== source.record.artifact.sha256
  ) {
    return false;
  }
  if (
    target !== null &&
    (journal.targetReleaseId !== target.record.releaseId ||
      journal.targetVersion !== target.record.version ||
      journal.targetManifestSha256 !== target.record.manifestSha256 ||
      journal.targetArtifactSha256 !== target.record.artifact.sha256)
  ) {
    return false;
  }
  if (journal.operation === 'recover') return false;
  return (
    deriveRunnerUpdateId(
      {
        operation: journal.operation,
        sourceManifestSha256: source.record.manifestSha256,
        targetManifestSha256: journal.targetManifestSha256,
      },
      nodeUpdateHasher,
    ) === journal.updateId
  );
}

function assertSameRelease(
  expected: VerifiedRelease,
  actual: VerifiedRelease,
): void {
  if (
    expected.manifestSha256 !== actual.manifestSha256 ||
    expected.artifact.sha256 !== actual.artifact.sha256 ||
    expected.artifact.sizeBytes !== actual.artifact.sizeBytes
  ) {
    throw new RunnerUpdateError(
      'update_target_release_unverified',
      'The target release changed during verification.',
    );
  }
}

function assertSameInstalledRelease(
  expected: VerifiedInstalledRelease,
  actual: VerifiedInstalledRelease,
): void {
  if (
    expected.record.releaseId !== actual.record.releaseId ||
    expected.release.manifestSha256 !== actual.release.manifestSha256 ||
    expected.release.artifact.sha256 !== actual.release.artifact.sha256 ||
    expected.release.artifact.sizeBytes !== actual.release.artifact.sizeBytes
  ) {
    throw new RunnerUpdateError(
      'update_previous_release_unverified',
      'The retained installed release changed during verification.',
    );
  }
}

function preflightError(reasons: readonly string[]): RunnerUpdateError {
  if (reasons.some((reason) => reason.includes('migration'))) {
    return new RunnerUpdateError(
      'update_migration_required',
      'The target release requires a blocked local-state migration.',
    );
  }
  if (reasons.some((reason) => reason.startsWith('rollback_'))) {
    return new RunnerUpdateError(
      'update_rollback_unproven',
      'Safe rollback to the current release cannot be proven.',
    );
  }
  if (reasons.includes('target_version_not_newer')) {
    return new RunnerUpdateError(
      'update_target_version_not_newer',
      'The target release must be newer than the active release.',
    );
  }
  return new RunnerUpdateError(
    'update_forward_compatibility_failed',
    'The target release is incompatible with current persisted state.',
  );
}

function updateErrorCode(error: unknown): RunnerUpdateErrorCode {
  return error instanceof RunnerUpdateError
    ? error.code
    : 'update_staging_failed';
}

async function releaseLease(lease: RunnerUpdateLease): Promise<void> {
  await lease.release().catch(() => undefined);
}

const nodeUpdateHasher = {
  sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  },
};
