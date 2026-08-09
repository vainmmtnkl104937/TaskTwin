import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  RunnerBuildIdentitySchema,
  type RunnerSoftwareIdentity,
} from '@tasktwin/runner-release';
import {
  evaluateTargetHealth,
  type RunnerStartupAttemptId,
  type RunnerStartupStatus,
  type RunnerTargetHealthResult,
} from '@tasktwin/runner-update';

import {
  WindowsRunnerServiceManager,
  WindowsRunnerServiceActivationConfigSchema,
  readWindowsRunnerServiceActivationConfig,
  type PrepareWindowsRunnerActivationInput,
  type WindowsRunnerServiceActivationConfig,
  type WindowsRunnerServiceActivationProof,
  type WindowsRunnerServiceState,
} from '../platform/windows/windows-service-manager.js';
import { runnerWindowsServiceName } from '../platform/windows/windows-service-identity.js';
import type { RunnerInstallationSecurityBoundary } from '../platform/windows/windows-runner-installation-acl.js';
import { reportedSoftwareIdentity } from '../release/build-identity.js';
import { FileRunnerStartupStatusStore } from '../runtime/startup-status-store.js';
import type { RunnerInstallationPaths } from './installation-layout.js';
import { releasePayloadRootName } from './release-tree-validator.js';
import type { VerifiedInstalledRelease } from './installed-release-store.js';
import type {
  PreparedRunnerActivation,
  RunnerUpdateServiceController,
} from './update-controller.js';

const HEALTH_POLL_INTERVAL_MS = 250;

interface WindowsUpdateServiceManager {
  prepareActivation(
    input: PrepareWindowsRunnerActivationInput,
  ): Promise<WindowsRunnerServiceActivationConfig>;
  attestActivation(input: {
    readonly activationConfigPath: string;
    readonly expected: WindowsRunnerServiceActivationConfig;
  }): Promise<WindowsRunnerServiceActivationProof>;
  currentBinaryPath(runnerDeviceId: string): Promise<string | null>;
  status(runnerDeviceId: string): Promise<WindowsRunnerServiceState>;
  stopAndWait(runnerDeviceId: string): Promise<void>;
  startAndWait(
    runnerDeviceId: string,
    timeoutMilliseconds?: number,
    activationProof?: WindowsRunnerServiceActivationProof,
  ): Promise<void>;
  rebindBinaryPath(input: {
    readonly runnerDeviceId: string;
    readonly expectedSourcePath: string;
    readonly targetPath: string;
    readonly activationProof?: WindowsRunnerServiceActivationProof;
  }): Promise<void>;
}

interface RunnerStartupStatusReader {
  read(): Promise<RunnerStartupStatus | null>;
}

export class WindowsRunnerUpdateServiceController implements RunnerUpdateServiceController {
  private priorStartupAttemptId: RunnerStartupAttemptId | null = null;
  private startupBaselineCaptured = false;
  private readonly activationProofs = new Map<
    string,
    WindowsRunnerServiceActivationProof
  >();

  constructor(
    private readonly runnerDeviceId: string,
    private readonly dataRoot: string,
    private readonly paths: RunnerInstallationPaths,
    private readonly manager: WindowsUpdateServiceManager,
    private readonly startupStatus: RunnerStartupStatusReader = new FileRunnerStartupStatusStore(
      paths.startupStatus,
    ),
    private readonly programData = process.env['ProgramData'],
    private readonly securityBoundary?: RunnerInstallationSecurityBoundary,
  ) {}

  async loadActivation(
    installedRelease: VerifiedInstalledRelease,
  ): Promise<PreparedRunnerActivation> {
    await this.securityBoundary?.validate();
    const activationConfigPath = join(
      installedRelease.paths.activation,
      'runner-service-activation.v1.json',
    );
    const persisted =
      await readWindowsRunnerServiceActivationConfig(activationConfigPath);
    const runtime = await releaseRuntime(installedRelease);
    const serviceName = runnerWindowsServiceName(this.runnerDeviceId);
    const config = WindowsRunnerServiceActivationConfigSchema.parse({
      schemaVersion: 1,
      activationId: persisted.activationId,
      releaseVersion: installedRelease.record.version,
      manifestSha256: installedRelease.record.manifestSha256,
      serviceName,
      runnerDeviceId: this.runnerDeviceId,
      dataRoot: this.dataRoot,
      nodeExecutable: runtime.nodeExecutable,
      runnerEntryPoint: runtime.runnerEntryPoint,
      serviceConfigPath: join(
        installedRelease.paths.activation,
        'runner-service.v1.json',
      ),
      serviceExecutablePath: join(
        installedRelease.paths.activation,
        `${serviceName}.exe`,
      ),
      serviceXmlPath: join(
        installedRelease.paths.activation,
        `${serviceName}.xml`,
      ),
      startupStatusPath: this.paths.startupStatus,
      updateJournalPath: this.paths.journal,
      logDirectory: this.paths.logs,
      softwareIdentity: runtime.softwareIdentity,
      requireNativeSecretAutoUnlock: persisted.requireNativeSecretAutoUnlock,
    });
    const proof = await this.manager.attestActivation({
      activationConfigPath,
      expected: config,
    });
    this.activationProofs.set(
      activationKey(config.serviceExecutablePath),
      proof,
    );
    return {
      activationId: config.activationId,
      serviceExecutablePath: config.serviceExecutablePath,
    };
  }

  async prepareActivation(input: {
    readonly installedRelease: VerifiedInstalledRelease;
    readonly activationId: PreparedRunnerActivation['activationId'];
    readonly requireNativeSecretAutoUnlock: boolean;
  }): Promise<PreparedRunnerActivation> {
    const runtime = await releaseRuntime(input.installedRelease);
    const manager = new WindowsRunnerServiceManager(
      runtime.runnerEntryPoint,
      this.dataRoot,
      this.programData,
    );
    const activation = await manager.prepareActivation({
      activationId: input.activationId,
      releaseVersion: input.installedRelease.record.version,
      manifestSha256: input.installedRelease.record.manifestSha256,
      runnerDeviceId: this.runnerDeviceId,
      activationDirectory: input.installedRelease.paths.activation,
      dataRoot: this.dataRoot,
      nodeExecutable: runtime.nodeExecutable,
      runnerEntryPoint: runtime.runnerEntryPoint,
      startupStatusPath: this.paths.startupStatus,
      updateJournalPath: this.paths.journal,
      logDirectory: this.paths.logs,
      softwareIdentity: runtime.softwareIdentity,
      requireNativeSecretAutoUnlock: input.requireNativeSecretAutoUnlock,
    });
    await this.securityBoundary?.protectAndValidate();
    const proof = await manager.attestActivation({
      activationConfigPath: join(
        input.installedRelease.paths.activation,
        'runner-service-activation.v1.json',
      ),
      expected: activation,
    });
    this.activationProofs.set(
      activationKey(activation.serviceExecutablePath),
      proof,
    );
    return {
      activationId: activation.activationId,
      serviceExecutablePath: activation.serviceExecutablePath,
    };
  }

  currentServiceExecutable(): Promise<string | null> {
    return this.manager.currentBinaryPath(this.runnerDeviceId);
  }

  stopAndWait(): Promise<void> {
    return this.manager.stopAndWait(this.runnerDeviceId);
  }

  async ensureRunning(): Promise<void> {
    await this.securityBoundary?.validate();
    const activationProof = await this.currentActivationProof();
    await this.manager.startAndWait(
      this.runnerDeviceId,
      undefined,
      activationProof,
    );
  }

  async rebind(input: {
    readonly expectedSourcePath: string;
    readonly targetPath: string;
  }): Promise<void> {
    await this.securityBoundary?.validate();
    const activationProof = this.activationProofs.get(
      activationKey(input.targetPath),
    );
    if (activationProof === undefined) {
      throw new Error('The target Runner activation has not been attested.');
    }
    return this.manager.rebindBinaryPath({
      runnerDeviceId: this.runnerDeviceId,
      expectedSourcePath: input.expectedSourcePath,
      targetPath: input.targetPath,
      activationProof,
    });
  }

  async startAndWait(): Promise<void> {
    await this.securityBoundary?.validate();
    const activationProof = await this.currentActivationProof();
    this.priorStartupAttemptId =
      (await this.startupStatus.read())?.startupAttemptId ?? null;
    this.startupBaselineCaptured = true;
    const state = await this.manager.status(this.runnerDeviceId);
    if (state === 'running') {
      await this.manager.stopAndWait(this.runnerDeviceId);
    }
    await this.manager.startAndWait(
      this.runnerDeviceId,
      undefined,
      activationProof,
    );
  }

  async verifyHealth(input: {
    readonly installedRelease: VerifiedInstalledRelease;
    readonly activation: PreparedRunnerActivation;
    readonly requireNativeSecretAutoUnlock: boolean;
    readonly timeoutMilliseconds: number;
  }): Promise<RunnerTargetHealthResult> {
    if (!this.startupBaselineCaptured) {
      // Crash recovery must not treat a status file left by an earlier process
      // as proof that the currently bound release started successfully.
      await this.startAndWait();
    }
    const runtime = await releaseRuntime(input.installedRelease);
    const deadline = Date.now() + input.timeoutMilliseconds;
    let startupAttemptId: RunnerStartupAttemptId | null = null;
    for (;;) {
      const status = await this.startupStatus.read();
      if (
        status !== null &&
        status.activationId === input.activation.activationId &&
        status.startupAttemptId !== this.priorStartupAttemptId
      ) {
        startupAttemptId ??= status.startupAttemptId;
      }
      const acceptedStatus =
        startupAttemptId !== null &&
        status?.startupAttemptId === startupAttemptId
          ? status
          : null;
      const serviceState = await this.manager.status(this.runnerDeviceId);
      const currentExecutable = await this.manager
        .currentBinaryPath(this.runnerDeviceId)
        .catch(() => null);
      const deadlineExpired = Date.now() >= deadline;
      const health = evaluateTargetHealth({
        expectedActivationId: input.activation.activationId,
        expectedStartupAttemptId:
          startupAttemptId ??
          ('pending_startup_attempt' as RunnerStartupAttemptId),
        expectedSoftwareIdentity: runtime.softwareIdentity,
        scmState:
          serviceState === 'running'
            ? 'running'
            : serviceState === 'stopped' || serviceState === 'not_installed'
              ? 'stopped'
              : 'unknown',
        scmExecutableMatches:
          currentExecutable !== null &&
          resolve(currentExecutable).toLowerCase() ===
            resolve(input.activation.serviceExecutablePath).toLowerCase(),
        startupStatus: acceptedStatus,
        controlPlaneAcknowledgement:
          acceptedStatus?.controlPlaneAcknowledgement ?? 'not_attempted',
        deadlineExpired,
        requireNativeSecretAutoUnlock: input.requireNativeSecretAutoUnlock,
      });
      if (health.decision !== 'pending' || deadlineExpired) return health;
      await delay(
        Math.min(HEALTH_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())),
      );
    }
  }

  private async currentActivationProof(): Promise<WindowsRunnerServiceActivationProof> {
    const serviceExecutable = await this.manager.currentBinaryPath(
      this.runnerDeviceId,
    );
    const activationProof =
      serviceExecutable === null
        ? undefined
        : this.activationProofs.get(activationKey(serviceExecutable));
    if (serviceExecutable === null || activationProof === undefined) {
      throw new Error('The active Runner activation has not been attested.');
    }
    return activationProof;
  }
}

async function releaseRuntime(release: VerifiedInstalledRelease): Promise<{
  readonly nodeExecutable: string;
  readonly runnerEntryPoint: string;
  readonly softwareIdentity: RunnerSoftwareIdentity;
}> {
  const payloadRoot = resolve(
    release.paths.payload,
    releasePayloadRootName(release.record.artifact.fileName),
  );
  const nodeExecutable = resolve(payloadRoot, 'runtime', 'node.exe');
  const runnerEntryPoint = resolve(payloadRoot, 'dist', 'index.js');
  const identityPath = resolve(
    payloadRoot,
    'dist',
    'release',
    'build-identity.json',
  );
  await Promise.all([
    assertRegular(nodeExecutable),
    assertRegular(runnerEntryPoint),
    assertRegular(identityPath),
  ]);
  const identity = RunnerBuildIdentitySchema.parse(
    JSON.parse(await readFile(identityPath, 'utf8')) as unknown,
  );
  return {
    nodeExecutable,
    runnerEntryPoint,
    softwareIdentity: reportedSoftwareIdentity(identity),
  };
}

async function assertRegular(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('The installed Runner runtime is incomplete.');
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function activationKey(path: string): string {
  return resolve(path).toLowerCase();
}
