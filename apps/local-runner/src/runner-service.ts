import { randomUUID } from 'node:crypto';

import {
  SECURE_INPUT_CAPABILITIES,
  type SecretProvider,
} from '@tasktwin/secure-run-inputs';
import {
  StoredRunnerCredentialSchema,
  WORKFLOW_VERIFICATION_CAPABILITY,
  WORKFLOW_EXTRACTION_CAPABILITY,
  type RunnerCapability,
  type RunnerDeviceMetadata,
  type StoredRunnerCredential,
} from '@tasktwin/runner-protocol';

import {
  ControlPlaneClientError,
  type RunnerControlPlaneTransport,
  type RunnerJobTransport,
} from './control-plane-client.js';
import type { RunnerCredentialStore } from './credential-store.js';
import type { BrowserSessionFactory } from './execution/browser-session.js';
import { RunJobWorker } from './job-dispatch/run-job-worker.js';
import type { RunnerKeyManager } from './secure-inputs/runner-key-manager.js';

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

export class LocalRunnerService {
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
    await this.keyManager?.ensureRegistered(credential);
    this.output.write('TaskTwin Local Runner started safely.');
    if (this.jobTransport !== undefined && this.browserSessions !== undefined) {
      const operation = new AbortController();
      const stopOperation = () => operation.abort();
      signal.addEventListener('abort', stopOperation, { once: true });
      const worker = new RunJobWorker(
        this.jobTransport,
        this.browserSessions,
        this.clock,
        this.output,
        this.runnerVersion,
        this.keyManager,
        this.secretProvider,
      );
      try {
        const jobs = worker
          .runLoop(credential, operation.signal)
          .finally(stopOperation);
        const heartbeat = this.runHeartbeatLoop(
          credential,
          operation.signal,
        ).finally(stopOperation);
        await Promise.all([jobs, heartbeat]);
        this.output.write('TaskTwin Local Runner stopped safely.');
        return;
      } finally {
        signal.removeEventListener('abort', stopOperation);
      }
    }
    await this.runHeartbeatLoop(credential, signal);
    this.output.write('TaskTwin Local Runner stopped safely.');
  }

  private async runHeartbeatLoop(
    credential: StoredRunnerCredential,
    signal: AbortSignal,
  ): Promise<void> {
    let nextIntervalSeconds = await this.sendHeartbeat(credential);
    while (!signal.aborted) {
      await this.clock
        .sleep(nextIntervalSeconds * 1_000, signal)
        .catch(() => undefined);
      if (signal.aborted) {
        break;
      }
      try {
        nextIntervalSeconds = await this.sendHeartbeat(credential);
      } catch (error: unknown) {
        if (error instanceof RunnerRevokedError) {
          this.output.write(
            'Runner authentication was rejected; heartbeat stopped.',
          );
          return;
        }
        throw error;
      }
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
      const response = await this.transport.heartbeat(
        credential,
        this.runnerVersion,
        this.capabilities(),
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
    const capabilities: RunnerCapability[] = [];
    if (this.browserSessions !== undefined) {
      capabilities.push(
        WORKFLOW_VERIFICATION_CAPABILITY,
        WORKFLOW_EXTRACTION_CAPABILITY,
      );
    }
    if (this.keyManager !== undefined) {
      capabilities.push(SECURE_INPUT_CAPABILITIES[0]);
      if (this.secretProvider?.isAvailable() === true) {
        capabilities.push(SECURE_INPUT_CAPABILITIES[1]);
      }
    }
    return capabilities;
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
