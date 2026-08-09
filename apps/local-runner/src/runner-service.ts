import { randomUUID } from 'node:crypto';

import {
  SECURE_INPUT_CAPABILITIES,
  type SecretProvider,
} from '@tasktwin/secure-run-inputs';
import {
  StoredRunnerCredentialSchema,
  WORKFLOW_VERIFICATION_CAPABILITY,
  WORKFLOW_EXTRACTION_CAPABILITY,
  WORKFLOW_APPROVAL_CAPABILITY,
  WORKFLOW_MANUAL_REPAIR_CAPABILITY,
  LOCATOR_REPAIR_PROPOSALS_CAPABILITY,
  type RunnerCapability,
  type RunnerDeviceMetadata,
  type StoredRunnerCredential,
} from '@tasktwin/runner-protocol';
import {
  DEFAULT_RUNNER_DRAIN_TIMEOUT_MS,
  RUNNER_SERVICE_RUNTIME_SCHEMA_VERSION,
  classifyHttpConnectionFailure,
  deriveAutonomyLevel,
  deriveSecretUnlockMode,
  deriveServiceCapabilities,
  deriveServiceStatus,
  reconnectDelayMilliseconds,
  type RunnerRuntimeMode,
  type RunnerRuntimeReport,
} from '@tasktwin/runner-service-runtime';

import {
  ControlPlaneClientError,
  type RunnerControlPlaneTransport,
  type RunnerJobTransport,
} from './control-plane-client.js';
import type { RunnerCredentialStore } from './credential-store.js';
import type { BrowserSessionFactory } from './execution/browser-session.js';
import { RunJobWorker } from './job-dispatch/run-job-worker.js';
import type { RunnerKeyManager } from './secure-inputs/runner-key-manager.js';
import type { LocalSecretRuntime } from './secrets/local-secret-runtime.js';
import type { LocalVaultSecretProvider } from './secrets/local-vault-secret-provider.js';
import type { RunnerSoftwareIdentity } from '@tasktwin/runner-release';
import {
  RunnerActivationIdSchema,
  RunnerStartupAttemptIdSchema,
  type RunnerControlPlaneAcknowledgement,
  type RunnerStartupStatus,
} from '@tasktwin/runner-update';
import type { RunnerStartupStatusWriter } from './runtime/startup-status-store.js';
import type { RunnerStartupHealthProbe } from './service/startup-health.js';
import {
  RunnerUpdateMaintenanceSnapshotSchema,
  maintenanceBlocksClaims,
  maintenanceIsDraining,
  type RunnerUpdateMaintenanceSnapshot,
  type RunnerUpdateMaintenanceSource,
} from './service/update-maintenance.js';

export interface RunnerOutput {
  write(message: string): void;
}

export interface RunnerClock {
  now(): Date;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export class RunnerRevokedError extends Error {
  constructor() {
    super('Runner authentication was rejected.');
    this.name = 'RunnerRevokedError';
  }
}

export interface DrainableRunWorker {
  hasActiveRun(): boolean;
  waitForActiveRun(): Promise<void>;
  forceCancelActiveRun(): void;
}

export interface RunnerUpdateRuntimeHooks {
  readonly activationId: string;
  readonly expectedSoftwareIdentity: RunnerSoftwareIdentity;
  readonly instanceLockHeld: boolean;
  readonly requireNativeSecretAutoUnlock: boolean;
  readonly controlPlaneAcknowledgementGraceMilliseconds?: number;
  readonly maintenanceSource: RunnerUpdateMaintenanceSource;
  readonly startupStatusWriter: RunnerStartupStatusWriter;
  readonly startupHealthProbe: RunnerStartupHealthProbe;
  readonly createStartupAttemptId?: () => string;
}

const DEFAULT_CONTROL_PLANE_ACKNOWLEDGEMENT_GRACE_MS = 5_000;
const MAX_CONTROL_PLANE_ACKNOWLEDGEMENT_GRACE_MS = 60_000;

class RunnerStartupCompatibilityAcknowledgementError extends Error {
  constructor() {
    super(
      'The reachable Control Plane did not acknowledge Runner compatibility.',
    );
    this.name = 'RunnerStartupCompatibilityAcknowledgementError';
  }
}

export async function drainRunWorker(input: {
  worker: DrainableRunWorker;
  timeoutMilliseconds: number;
  clock: RunnerClock;
  output: RunnerOutput;
}): Promise<'completed' | 'cancelled'> {
  if (!input.worker.hasActiveRun()) return 'completed';
  const timeout = new AbortController();
  let timedOut = false;
  try {
    await Promise.race([
      input.worker.waitForActiveRun().catch(() => undefined),
      input.clock
        .sleep(input.timeoutMilliseconds, timeout.signal)
        .then(() => {
          timedOut = true;
        })
        .catch(() => undefined),
    ]);
  } finally {
    timeout.abort();
  }
  if (!timedOut || !input.worker.hasActiveRun()) return 'completed';
  input.output.write('RUNNER_DRAIN_TIMED_OUT');
  input.worker.forceCancelActiveRun();
  await input.worker.waitForActiveRun().catch(() => undefined);
  return 'cancelled';
}

export class LocalRunnerService {
  private initialized = false;
  private draining = false;
  private currentWorker: RunJobWorker | null = null;
  private maintenanceSnapshot: RunnerUpdateMaintenanceSnapshot = {
    state: 'inactive',
  };
  private startupStatus: RunnerStartupStatus | null = null;
  private startupCompatibilityGate:
    'not_required' | 'pending' | 'satisfied' | 'failed' = 'not_required';
  private successfulResponseWithoutCompatibilityAcknowledgement = false;
  private remoteAdmissionReady = false;

  constructor(
    private readonly store: RunnerCredentialStore,
    private readonly transport: RunnerControlPlaneTransport,
    private readonly output: RunnerOutput,
    private readonly clock: RunnerClock,
    private readonly runnerVersion: string,
    private readonly jobTransport?: RunnerJobTransport,
    private readonly browserSessions?: BrowserSessionFactory,
    private readonly keyManager?: RunnerKeyManager,
    private readonly secretProvider?: SecretProvider,
    private readonly executionConfiguration: {
      headed: boolean;
      attended: boolean;
    } = { headed: false, attended: false },
    private readonly localSecretRuntime?: LocalSecretRuntime,
    private readonly localSecretProvider?: LocalVaultSecretProvider,
    private readonly runtimeConfiguration: {
      runtimeMode: RunnerRuntimeMode;
      serviceVerified: boolean;
      nativeProtectorAvailable: boolean;
      drainTimeoutMilliseconds: number;
    } = {
      runtimeMode: 'unattended_process',
      serviceVerified: false,
      nativeProtectorAvailable: false,
      drainTimeoutMilliseconds: DEFAULT_RUNNER_DRAIN_TIMEOUT_MS,
    },
    private readonly softwareIdentity?: RunnerSoftwareIdentity,
    private readonly updateRuntime?: RunnerUpdateRuntimeHooks,
  ) {}

  async pair(input: {
    origin: string;
    displayName: string;
    platform: RunnerDeviceMetadata['platform'];
    architecture: RunnerDeviceMetadata['architecture'];
  }): Promise<void> {
    const installationId = randomUUID();
    const session = await this.transport.createPairingSession(input.origin, {
      schemaVersion: 1,
      metadata: {
        displayName: input.displayName,
        platform: input.platform,
        architecture: input.architecture,
        runnerVersion: this.runnerVersion,
        installationId,
      },
    });
    this.output.write(`Verification URL: ${session.verificationUri}`);
    this.output.write(`Pairing code: ${session.userCode}`);
    let intervalSeconds = session.intervalSeconds;
    for (;;) {
      await this.clock.sleep(intervalSeconds * 1_000);
      const result = await this.transport.pollPairing(
        input.origin,
        session.deviceCode,
      );
      switch (result.status) {
        case 'authorization_pending':
        case 'slow_down':
          intervalSeconds = result.intervalSeconds;
          break;
        case 'access_denied':
          throw new Error('Pairing was denied.');
        case 'expired':
          throw new Error('Pairing expired.');
        case 'paired': {
          const credential = StoredRunnerCredentialSchema.parse({
            schemaVersion: 1,
            controlPlaneOrigin: input.origin,
            runnerDeviceId: result.runnerDeviceId,
            workspaceId: result.workspaceId,
            installationId,
            credential: result.credential,
            savedAt: this.clock.now().toISOString(),
          });
          await this.store.save(credential);
          await this.keyManager?.ensureRegistered(credential);
          await this.sendHeartbeat(credential);
          this.output.write('TaskTwin Local Runner paired successfully.');
          return;
        }
      }
    }
  }

  async status(): Promise<void> {
    const credential = await this.store.load();
    if (credential === null) {
      this.output.write('Local status: not paired.');
      return;
    }
    try {
      await this.keyManager?.ensureRegistered(credential);
      await this.sendHeartbeat(credential);
      this.output.write('Local status: paired. Remote status: online.');
    } catch (error: unknown) {
      if (error instanceof RunnerRevokedError) {
        this.output.write(
          'Local status: paired. Remote authentication: rejected or revoked.',
        );
        return;
      }
      throw error;
    }
  }

  async start(signal: AbortSignal): Promise<void> {
    const credential = await this.requireCredential();
    await this.initializeUpdateRuntime(signal);
    try {
      await this.localSecretRuntime?.prepare(credential, signal);
      await this.verifyLocalStartupHealth(signal);
    } catch (error: unknown) {
      await this.writeStartupStatus('failed').catch(() => undefined);
      await this.localSecretRuntime?.dispose().catch(() => undefined);
      throw error;
    }
    let failures = 0;
    const reconnectWait = new AbortController();
    const beginDrain = () => {
      this.draining = true;
      this.currentWorker?.beginDrain();
      reconnectWait.abort();
    };
    signal.addEventListener('abort', beginDrain, { once: true });
    if (signal.aborted) beginDrain();
    this.initialized = true;
    await this.writeStartupStatus(this.startupState());
    this.output.write('TaskTwin Local Runner initialized local state.');
    const maintenanceOperation = new AbortController();
    let maintenanceFailure: unknown;
    const maintenance = this.watchUpdateMaintenanceLifetime(
      credential,
      maintenanceOperation.signal,
    ).catch((error: unknown) => {
      maintenanceFailure = error;
      beginDrain();
    });
    try {
      while (!this.draining) {
        try {
          if (this.startupCompatibilityGate === 'pending') {
            await this.sendHeartbeatWithStartupAcknowledgementGrace(
              credential,
              reconnectWait.signal,
            );
          }
          await this.keyManager?.ensureRegistered(credential);
          if (this.localSecretRuntime?.isNativeUnlockVerified?.() === true) {
            await this.localSecretRuntime.refresh(credential);
          }
          this.remoteAdmissionReady = true;
          await this.sendHeartbeat(credential);
          failures = 0;
          await this.runConnectedSession(credential);
        } catch (error: unknown) {
          if (error instanceof RunnerRevokedError) {
            this.output.write('RUNNER_RUNTIME_REVOKED');
            return;
          }
          if (error instanceof RunnerStartupCompatibilityAcknowledgementError) {
            this.output.write('RUNNER_STARTUP_COMPATIBILITY_ACK_FAILED');
            return;
          }
          if (this.draining) break;
          const classification =
            error instanceof ControlPlaneClientError
              ? classifyHttpConnectionFailure(error.status)
              : 'retryable';
          if (classification === 'permanent') {
            this.output.write('RUNNER_CONNECTION_PERMANENT_FAILURE');
            return;
          }
          failures += 1;
          this.output.write('CONTROL_PLANE_UNAVAILABLE');
          await this.clock
            .sleep(reconnectDelayMilliseconds(failures), reconnectWait.signal)
            .catch(() => undefined);
        }
      }
      if (this.draining) {
        await this.sendHeartbeat(credential).catch(() => undefined);
      }
      await this.drainCurrentWorker();
      this.output.write('TaskTwin Local Runner stopped safely.');
    } finally {
      maintenanceOperation.abort();
      await maintenance;
      this.initialized = false;
      this.currentWorker = null;
      try {
        await this.localSecretRuntime?.dispose();
      } finally {
        await this.writeStartupStatus('stopped').catch(() => undefined);
        signal.removeEventListener('abort', beginDrain);
      }
    }
    if (maintenanceFailure !== undefined) throw maintenanceFailure;
  }

  private async runConnectedSession(
    credential: StoredRunnerCredential,
  ): Promise<void> {
    await this.refreshMaintenanceBeforeAdmission(credential);
    if (this.jobTransport !== undefined && this.browserSessions !== undefined) {
      const operation = new AbortController();
      const worker = new RunJobWorker(
        this.jobTransport,
        this.browserSessions,
        this.clock,
        this.output,
        this.runnerVersion,
        this.keyManager,
        this.secretProvider,
        this.executionConfiguration,
        this.localSecretProvider,
        () => this.localSecretRuntime?.currentPin(),
        async () => {
          await this.refreshMaintenanceBeforeAdmission(credential);
          return !this.claimAdmissionBlocked();
        },
      );
      this.currentWorker = worker;
      if (this.draining) worker.beginDrain();
      else if (this.claimAdmissionBlocked()) worker.pauseClaims();
      try {
        const jobs = worker
          .runLoop(credential, operation.signal)
          .finally(() => operation.abort());
        const heartbeat = this.runHeartbeatLoop(
          credential,
          operation.signal,
        ).finally(() => operation.abort());
        const drain = this.waitForDrain(worker, operation);
        await Promise.all([jobs, heartbeat, drain]);
      } finally {
        operation.abort();
        if (this.currentWorker === worker) this.currentWorker = null;
      }
      return;
    }
    const operation = new AbortController();
    const heartbeat = this.runHeartbeatLoop(
      credential,
      operation.signal,
    ).finally(() => operation.abort());
    const drain = this.waitUntilDraining(operation).finally(() =>
      operation.abort(),
    );
    await Promise.all([heartbeat, drain]);
  }

  private async waitForDrain(
    worker: RunJobWorker,
    operation: AbortController,
  ): Promise<void> {
    while (!this.draining && !operation.signal.aborted) {
      await this.clock.sleep(100, operation.signal).catch(() => undefined);
    }
    if (!this.draining) return;
    worker.beginDrain();
    await this.drainWorker(worker);
    operation.abort();
  }

  private async initializeUpdateRuntime(signal: AbortSignal): Promise<void> {
    if (this.updateRuntime === undefined) return;
    const actualIdentity = this.softwareIdentity;
    if (actualIdentity === undefined) {
      throw new Error(
        'Managed Runner startup requires embedded software identity.',
      );
    }
    this.maintenanceSnapshot = RunnerUpdateMaintenanceSnapshotSchema.parse(
      await this.updateRuntime.maintenanceSource.current(),
    );
    const acknowledgementGraceMilliseconds =
      this.updateRuntime.controlPlaneAcknowledgementGraceMilliseconds ??
      DEFAULT_CONTROL_PLANE_ACKNOWLEDGEMENT_GRACE_MS;
    if (
      !Number.isInteger(acknowledgementGraceMilliseconds) ||
      acknowledgementGraceMilliseconds < 1 ||
      acknowledgementGraceMilliseconds >
        MAX_CONTROL_PLANE_ACKNOWLEDGEMENT_GRACE_MS
    ) {
      throw new Error(
        'Managed Runner Control Plane acknowledgement grace is invalid.',
      );
    }
    this.startupCompatibilityGate = maintenanceNeedsStartupAcknowledgement(
      this.maintenanceSnapshot,
    )
      ? 'pending'
      : 'not_required';
    this.successfulResponseWithoutCompatibilityAcknowledgement = false;
    this.remoteAdmissionReady = false;
    const startupAttemptId = RunnerStartupAttemptIdSchema.parse(
      this.updateRuntime.createStartupAttemptId?.() ?? randomUUID(),
    );
    this.startupStatus = {
      schemaVersion: 1,
      activationId: RunnerActivationIdSchema.parse(
        this.updateRuntime.activationId,
      ),
      startupAttemptId,
      softwareIdentity: actualIdentity,
      state: 'starting',
      observedAt: this.clock.now().toISOString(),
      acceptsNewJobs: false,
      activeWork: false,
      checks: {
        identity: 'pending',
        instanceLock: 'pending',
        workflowEngine: 'pending',
        policyRuntime: 'pending',
        chromium: 'pending',
        localSecretStore: 'pending',
        nativeSecretAutoUnlock: this.updateRuntime.requireNativeSecretAutoUnlock
          ? 'pending'
          : 'not_required',
      },
      controlPlaneAcknowledgement: 'not_attempted',
    };
    if (signal.aborted) {
      throw new Error('Managed Runner startup was aborted.');
    }
    if (this.maintenanceSnapshot.state === 'manual_recovery_required') {
      this.startupStatus = {
        ...this.startupStatus,
        state: 'failed',
      };
      await this.updateRuntime.startupStatusWriter.write(this.startupStatus);
      throw new Error(
        'Managed Runner startup is blocked pending manual update recovery.',
      );
    }
    await this.updateRuntime.startupStatusWriter.write(this.startupStatus);
  }

  private async verifyLocalStartupHealth(signal: AbortSignal): Promise<void> {
    if (this.updateRuntime === undefined) return;
    if (this.startupStatus === null || this.softwareIdentity === undefined) {
      throw new Error('Managed Runner startup status is unavailable.');
    }
    const checks = await this.updateRuntime.startupHealthProbe.run({
      identityMatches: softwareIdentityMatches(
        this.softwareIdentity,
        this.updateRuntime.expectedSoftwareIdentity,
      ),
      instanceLockHeld: this.updateRuntime.instanceLockHeld,
      localSecretStoreHealthy:
        this.localSecretRuntime !== undefined &&
        this.localSecretRuntime.startupHealth?.() !== 'corrupted',
      nativeSecretAutoUnlockRequired:
        this.updateRuntime.requireNativeSecretAutoUnlock,
      nativeSecretAutoUnlockVerified:
        this.localSecretRuntime?.isNativeUnlockVerified?.() === true,
      signal,
    });
    this.startupStatus = { ...this.startupStatus, checks };
    if (
      checks.identity !== 'passed' ||
      checks.instanceLock !== 'passed' ||
      checks.workflowEngine !== 'passed' ||
      checks.policyRuntime !== 'passed' ||
      checks.chromium !== 'passed' ||
      checks.localSecretStore !== 'passed' ||
      checks.nativeSecretAutoUnlock === 'failed' ||
      checks.nativeSecretAutoUnlock === 'pending'
    ) {
      throw new Error('Managed Runner startup health verification failed.');
    }
  }

  private async watchUpdateMaintenanceLifetime(
    credential: StoredRunnerCredential,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.updateRuntime === undefined) {
      return;
    }
    while (!signal.aborted) {
      await this.updateRuntime.maintenanceSource
        .waitForChange(signal, 1_000)
        .catch((error: unknown) => {
          if (!signal.aborted) throw error;
        });
      if (signal.aborted) return;
      await this.refreshMaintenanceBeforeAdmission(credential, true);
      const worker = this.currentWorker;
      if (
        maintenanceIsDraining(this.maintenanceSnapshot) &&
        worker?.hasUnsettledWork() === true
      ) {
        await Promise.race([
          worker.waitForQuiescence(signal),
          this.updateRuntime.maintenanceSource.waitForChange(signal, 1_000),
        ]).catch((error: unknown) => {
          if (!signal.aborted) throw error;
        });
        if (!signal.aborted) {
          await this.writeStartupStatus(this.startupState());
        }
      }
    }
  }

  private async refreshMaintenanceBeforeAdmission(
    credential: StoredRunnerCredential,
    bestEffortHeartbeat = false,
  ): Promise<void> {
    const refresh = await this.refreshUpdateMaintenance(false);
    if (refresh.admissionChanged) {
      try {
        await this.sendHeartbeatRequest(credential);
      } catch (error: unknown) {
        if (!bestEffortHeartbeat || error instanceof RunnerRevokedError) {
          throw error;
        }
      }
    }
    await this.writeStartupStatus(this.startupState());
  }

  private async refreshUpdateMaintenance(
    writeStatus: boolean,
  ): Promise<{ readonly admissionChanged: boolean }> {
    if (this.updateRuntime === undefined) return { admissionChanged: false };
    let snapshot: RunnerUpdateMaintenanceSnapshot;
    try {
      snapshot = RunnerUpdateMaintenanceSnapshotSchema.parse(
        await this.updateRuntime.maintenanceSource.current(),
      );
    } catch (error: unknown) {
      this.currentWorker?.pauseClaims();
      this.maintenanceSnapshot = { state: 'manual_recovery_required' };
      await this.writeStartupStatus('failed').catch(() => undefined);
      throw error;
    }
    const previouslyBlocked = maintenanceBlocksClaims(this.maintenanceSnapshot);
    this.maintenanceSnapshot = snapshot;
    if (maintenanceBlocksClaims(snapshot)) this.currentWorker?.pauseClaims();
    else if (!this.draining) this.currentWorker?.resumeClaims();
    if (snapshot.state === 'manual_recovery_required') {
      await this.writeStartupStatus('failed').catch(() => undefined);
      throw new Error(
        'Managed Runner operation is blocked pending manual update recovery.',
      );
    }
    if (writeStatus) await this.writeStartupStatus(this.startupState());
    return {
      admissionChanged:
        previouslyBlocked !== maintenanceBlocksClaims(this.maintenanceSnapshot),
    };
  }

  private startupState(): RunnerStartupStatus['state'] {
    if (this.maintenanceSnapshot.state === 'manual_recovery_required') {
      return 'failed';
    }
    if (this.startupCompatibilityGate === 'failed') return 'failed';
    return this.draining || maintenanceIsDraining(this.maintenanceSnapshot)
      ? 'draining'
      : this.startupCompatibilityGate === 'pending'
        ? 'starting'
        : 'healthy';
  }

  private async writeStartupStatus(
    state: RunnerStartupStatus['state'],
  ): Promise<void> {
    if (this.updateRuntime === undefined || this.startupStatus === null) return;
    const next: RunnerStartupStatus = {
      ...this.startupStatus,
      state,
      observedAt: this.clock.now().toISOString(),
      acceptsNewJobs:
        state === 'healthy' &&
        this.initialized &&
        this.currentWorker?.acceptsNewJobs() === true &&
        !this.claimAdmissionBlocked(),
      activeWork: this.currentWorker?.hasUnsettledWork() === true,
    };
    await this.updateRuntime.startupStatusWriter.write(next);
    this.startupStatus = next;
  }

  private async waitUntilDraining(operation: AbortController): Promise<void> {
    while (!this.draining && !operation.signal.aborted) {
      await this.clock.sleep(100, operation.signal).catch(() => undefined);
    }
    operation.abort();
  }

  private async drainCurrentWorker(): Promise<void> {
    if (this.currentWorker !== null) {
      this.currentWorker.beginDrain();
      await this.drainWorker(this.currentWorker);
    }
  }

  private async drainWorker(worker: RunJobWorker): Promise<void> {
    await drainRunWorker({
      worker,
      timeoutMilliseconds: this.runtimeConfiguration.drainTimeoutMilliseconds,
      clock: this.clock,
      output: this.output,
    });
  }

  private async runHeartbeatLoop(
    credential: StoredRunnerCredential,
    signal: AbortSignal,
  ): Promise<void> {
    let nextIntervalSeconds = 1;
    while (!signal.aborted) {
      await this.clock
        .sleep(nextIntervalSeconds * 1_000, signal)
        .catch(() => undefined);
      if (signal.aborted) {
        break;
      }
      if (this.draining) return;
      nextIntervalSeconds = await this.sendHeartbeat(credential);
    }
  }

  async unpair(): Promise<void> {
    await this.store.clear();
    await this.keyManager?.clear();
    this.output.write(
      'Local credential removed. Remote revocation is a separate administrative action.',
    );
  }

  private async requireCredential(): Promise<StoredRunnerCredential> {
    const credential = await this.store.load();
    if (credential === null) {
      throw new Error('The Local Runner is not paired.');
    }
    return credential;
  }

  private async sendHeartbeat(
    credential: StoredRunnerCredential,
  ): Promise<number> {
    await this.refreshUpdateMaintenance(false);
    return this.sendHeartbeatRequest(credential);
  }

  private async sendHeartbeatWithStartupAcknowledgementGrace(
    credential: StoredRunnerCredential,
    signal: AbortSignal,
  ): Promise<number> {
    if (this.startupCompatibilityGate !== 'pending') {
      if (this.startupCompatibilityGate === 'failed') {
        throw new RunnerStartupCompatibilityAcknowledgementError();
      }
      return this.sendHeartbeat(credential);
    }
    let nextIntervalSeconds: number | null = null;
    let firstFailure: unknown;
    try {
      nextIntervalSeconds = await this.sendHeartbeat(credential);
    } catch (error: unknown) {
      if (
        error instanceof RunnerRevokedError ||
        (error instanceof ControlPlaneClientError && error.status === null)
      ) {
        throw error;
      }
      firstFailure = error;
    }
    if (this.startupCompatibilityGate !== 'pending') {
      if (this.startupCompatibilityGate === 'failed') {
        throw new RunnerStartupCompatibilityAcknowledgementError();
      }
      if (firstFailure !== undefined) throw firstFailure;
      return nextIntervalSeconds ?? 1;
    }
    const graceMilliseconds =
      this.updateRuntime?.controlPlaneAcknowledgementGraceMilliseconds ??
      DEFAULT_CONTROL_PLANE_ACKNOWLEDGEMENT_GRACE_MS;
    await this.clock.sleep(graceMilliseconds, signal).catch(() => undefined);
    if (signal.aborted) {
      throw new Error('Managed Runner startup acknowledgement was aborted.');
    }
    let finalFailure: unknown;
    try {
      nextIntervalSeconds = await this.sendHeartbeat(credential);
    } catch (error: unknown) {
      if (error instanceof RunnerRevokedError) throw error;
      finalFailure = error;
    }
    if (
      this.startupCompatibilityGate === 'pending' &&
      isTemporarilyUnavailableControlPlaneError(finalFailure) &&
      !this.successfulResponseWithoutCompatibilityAcknowledgement
    ) {
      this.startupCompatibilityGate = 'satisfied';
      await this.recordControlPlaneAcknowledgement('offline');
      throw finalFailure;
    }
    if (
      this.startupCompatibilityGate === 'pending' &&
      this.successfulResponseWithoutCompatibilityAcknowledgement &&
      (finalFailure === undefined ||
        isTemporarilyUnavailableControlPlaneError(finalFailure))
    ) {
      this.startupCompatibilityGate = 'satisfied';
      await this.writeStartupStatus(this.startupState());
      if (finalFailure !== undefined) throw finalFailure;
      return nextIntervalSeconds ?? 1;
    }
    if (this.startupCompatibilityGate === 'pending') {
      this.startupCompatibilityGate = 'failed';
      await this.writeStartupStatus('failed').catch(() => undefined);
      throw new RunnerStartupCompatibilityAcknowledgementError();
    }
    return nextIntervalSeconds ?? 1;
  }

  private async sendHeartbeatRequest(
    credential: StoredRunnerCredential,
  ): Promise<number> {
    try {
      const result =
        this.softwareIdentity === undefined
          ? await this.transport.heartbeat(
              credential,
              this.runnerVersion,
              this.capabilities(),
              this.runtimeReport(),
            )
          : await this.transport.heartbeat(
              credential,
              this.runnerVersion,
              this.capabilities(),
              this.runtimeReport(),
              this.softwareIdentity,
            );
      const acknowledgement =
        result.compatibilityAcknowledgement ?? 'not_attempted';
      if (
        maintenanceNeedsStartupAcknowledgement(this.maintenanceSnapshot) &&
        (acknowledgement === 'update_required' ||
          acknowledgement === 'unsupported')
      ) {
        this.startupCompatibilityGate = 'failed';
      } else if (this.startupCompatibilityGate === 'pending') {
        if (
          acknowledgement === 'compatible' ||
          acknowledgement === 'update_recommended'
        ) {
          this.startupCompatibilityGate = 'satisfied';
        } else {
          this.successfulResponseWithoutCompatibilityAcknowledgement = true;
        }
      }
      const startupAcknowledgement =
        this.maintenanceSnapshot.state === 'rolling_back' &&
        (acknowledgement === 'update_required' ||
          acknowledgement === 'unsupported')
          ? 'not_attempted'
          : acknowledgement;
      await this.recordControlPlaneAcknowledgement(startupAcknowledgement);
      return result.response.nextHeartbeatInSeconds;
    } catch (error: unknown) {
      if (
        error instanceof ControlPlaneClientError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw new RunnerRevokedError();
      }
      if (
        error instanceof ControlPlaneClientError &&
        error.status === null &&
        !this.successfulResponseWithoutCompatibilityAcknowledgement &&
        this.startupCompatibilityGate !== 'failed'
      ) {
        if (this.startupCompatibilityGate === 'pending') {
          this.startupCompatibilityGate = 'satisfied';
        }
        await this.recordControlPlaneAcknowledgement('offline').catch(
          () => undefined,
        );
      }
      throw error;
    }
  }

  private async recordControlPlaneAcknowledgement(
    acknowledgement: RunnerControlPlaneAcknowledgement,
  ): Promise<void> {
    if (this.startupStatus === null) return;
    this.startupStatus = {
      ...this.startupStatus,
      controlPlaneAcknowledgement: acknowledgement,
    };
    await this.writeStartupStatus(this.startupState());
  }

  private capabilities(): RunnerCapability[] {
    if (this.claimAdmissionBlocked()) return [];
    const capabilities: RunnerCapability[] = [];
    if (this.browserSessions !== undefined) {
      capabilities.push(
        WORKFLOW_VERIFICATION_CAPABILITY,
        WORKFLOW_EXTRACTION_CAPABILITY,
      );
      if (this.jobTransport !== undefined) {
        capabilities.push(WORKFLOW_APPROVAL_CAPABILITY);
        if (
          this.executionConfiguration.headed &&
          this.executionConfiguration.attended
        ) {
          capabilities.push(WORKFLOW_MANUAL_REPAIR_CAPABILITY);
          capabilities.push(LOCATOR_REPAIR_PROPOSALS_CAPABILITY);
        }
      }
    }
    if (this.keyManager !== undefined) {
      capabilities.push(SECURE_INPUT_CAPABILITIES[0]);
      if (this.secretProvider?.isAvailable() === true) {
        capabilities.push(SECURE_INPUT_CAPABILITIES[1]);
      }
    }
    if (this.initialized) {
      for (const capability of deriveServiceCapabilities(
        this.capabilityState(),
      )) {
        capabilities.push(capability);
      }
    }
    return capabilities;
  }

  private capabilityState() {
    return {
      runtimeMode: this.runtimeConfiguration.runtimeMode,
      headed: this.executionConfiguration.headed,
      jobWorkerAvailable: this.jobTransport !== undefined,
      browserAvailable: this.browserSessions !== undefined,
      serviceVerified: this.runtimeConfiguration.serviceVerified,
      nativeProtectorAvailable:
        this.runtimeConfiguration.nativeProtectorAvailable,
      nativeUnlockVerified:
        this.localSecretRuntime?.isNativeUnlockVerified?.() === true,
      configuredUnlockMode:
        this.localSecretRuntime?.secretUnlockMode?.() ?? 'none',
      vaultReady: this.localSecretRuntime?.isReady() === true,
      localSecretProviderAvailable: this.localSecretProvider !== undefined,
      inventorySynchronized:
        this.localSecretRuntime?.currentPin() !== undefined,
      draining: this.claimAdmissionBlocked(),
    };
  }

  private claimAdmissionBlocked(): boolean {
    return (
      this.draining ||
      maintenanceBlocksClaims(this.maintenanceSnapshot) ||
      (this.updateRuntime !== undefined && !this.remoteAdmissionReady)
    );
  }

  private runtimeReport(): RunnerRuntimeReport {
    const state = this.capabilityState();
    const autonomyLevel = deriveAutonomyLevel(state);
    return {
      schemaVersion: RUNNER_SERVICE_RUNTIME_SCHEMA_VERSION,
      runtimeMode: this.runtimeConfiguration.runtimeMode,
      autonomyLevel,
      serviceStatus: deriveServiceStatus(state),
      secretUnlockMode: deriveSecretUnlockMode(state),
      restartResilient: autonomyLevel === 'boot_resilient',
    };
  }
}

export const systemClock: RunnerClock = {
  now: () => new Date(),
  sleep: (milliseconds, signal) =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, milliseconds);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new Error('Heartbeat wait aborted.'));
        },
        { once: true },
      );
    }),
};

function softwareIdentityMatches(
  actual: RunnerSoftwareIdentity,
  expected: RunnerSoftwareIdentity,
): boolean {
  return (
    actual.product === expected.product &&
    actual.version === expected.version &&
    actual.runnerProtocolVersion === expected.runnerProtocolVersion &&
    actual.workflowSchemaVersion === expected.workflowSchemaVersion &&
    actual.localStateSchemaVersion === expected.localStateSchemaVersion &&
    actual.platform === expected.platform &&
    actual.architecture === expected.architecture
  );
}

function maintenanceNeedsStartupAcknowledgement(
  snapshot: RunnerUpdateMaintenanceSnapshot,
): boolean {
  return (
    snapshot.state === 'starting_target' ||
    snapshot.state === 'verifying_target'
  );
}

function isTemporarilyUnavailableControlPlaneError(
  error: unknown,
): error is ControlPlaneClientError {
  return (
    error instanceof ControlPlaneClientError &&
    classifyHttpConnectionFailure(error.status) === 'retryable'
  );
}
