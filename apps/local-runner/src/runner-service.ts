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
    await this.localSecretRuntime?.prepare(credential, signal);
    let failures = 0;
    const beginDrain = () => {
      this.draining = true;
      this.currentWorker?.beginDrain();
    };
    signal.addEventListener('abort', beginDrain, { once: true });
    this.output.write('TaskTwin Local Runner initialized local state.');
    try {
      while (!this.draining) {
        try {
          await this.keyManager?.ensureRegistered(credential);
          if (this.localSecretRuntime?.isNativeUnlockVerified?.() === true) {
            await this.localSecretRuntime.refresh(credential);
          }
          this.initialized = true;
          await this.sendHeartbeat(credential);
          failures = 0;
          await this.runConnectedSession(credential);
        } catch (error: unknown) {
          if (error instanceof RunnerRevokedError) {
            this.output.write('RUNNER_RUNTIME_REVOKED');
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
            .sleep(reconnectDelayMilliseconds(failures), signal)
            .catch(() => undefined);
        }
      }
      if (this.draining) {
        await this.sendHeartbeat(credential).catch(() => undefined);
      }
      await this.drainCurrentWorker();
      this.output.write('TaskTwin Local Runner stopped safely.');
    } finally {
      this.initialized = false;
      this.currentWorker = null;
      await this.localSecretRuntime?.dispose();
      signal.removeEventListener('abort', beginDrain);
    }
  }

  private async runConnectedSession(
    credential: StoredRunnerCredential,
  ): Promise<void> {
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
      );
      this.currentWorker = worker;
      if (this.draining) worker.beginDrain();
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
    try {
      const response =
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
      return response.nextHeartbeatInSeconds;
    } catch (error: unknown) {
      if (
        error instanceof ControlPlaneClientError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw new RunnerRevokedError();
      }
      throw error;
    }
  }

  private capabilities(): RunnerCapability[] {
    if (this.draining) return [];
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
      draining: this.draining,
    };
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
