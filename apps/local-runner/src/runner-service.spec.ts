import type {
  PairingPollingResponse,
  StoredRunnerCredential,
} from '@tasktwin/runner-protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  ControlPlaneClientError,
  type RunnerControlPlaneTransport,
} from './control-plane-client.js';
import {
  CredentialStoreError,
  InMemoryCredentialStore,
} from './credential-store.js';
import {
  LocalRunnerService,
  drainRunWorker,
  type RunnerClock,
} from './runner-service.js';
import type { LocalSecretRuntime } from './secrets/local-secret-runtime.js';
import type { LocalVaultSecretProvider } from './secrets/local-vault-secret-provider.js';
import type { RunnerStartupStatus } from '@tasktwin/runner-update';

const paired: Extract<PairingPollingResponse, { status: 'paired' }> = {
  schemaVersion: 1,
  status: 'paired',
  runnerDeviceId: '753ff8fc-4267-4d99-b741-41485f5bab45',
  workspaceId: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
  credential: 'A'.repeat(43),
  heartbeatIntervalSeconds: 30,
};

function setup(polls: PairingPollingResponse[] = [paired]) {
  const store = new InMemoryCredentialStore();
  const output: string[] = [];
  const transport = {
    createPairingSession: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      userCode: 'ABCD-EFGH-JKMP',
      deviceCode: 'D'.repeat(43),
      verificationUri: 'https://tasktwin.example/runner-pairing',
      expiresInSeconds: 600,
      intervalSeconds: 5,
    }),
    pollPairing: vi.fn(),
    heartbeat: vi.fn().mockResolvedValue({
      response: {
        schemaVersion: 1,
        runnerDeviceId: paired.runnerDeviceId,
        workspaceId: paired.workspaceId,
        connectionStatus: 'online',
        nextHeartbeatInSeconds: 30,
      },
    }),
  };
  for (const poll of polls) {
    transport.pollPairing.mockResolvedValueOnce(poll);
  }
  const clock: RunnerClock = {
    now: () => new Date('2026-07-30T12:00:00.000Z'),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
  const service = new LocalRunnerService(
    store,
    transport as unknown as RunnerControlPlaneTransport,
    { write: (message) => output.push(message) },
    clock,
    '0.1.0',
  );
  return { service, store, output, transport, clock };
}

describe('LocalRunnerService', () => {
  it('reports safe immutable software identity in heartbeat', async () => {
    const context = setup();
    const credential: StoredRunnerCredential = {
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    };
    await context.store.save(credential);
    const softwareIdentity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      softwareIdentity.version,
      undefined,
      undefined,
      undefined,
      undefined,
      { headed: false, attended: false },
      undefined,
      undefined,
      {
        runtimeMode: 'unattended_process',
        serviceVerified: false,
        nativeProtectorAvailable: false,
        drainTimeoutMilliseconds: 60_000,
      },
      softwareIdentity,
    );
    await service.status();
    expect(context.transport.heartbeat).toHaveBeenCalledWith(
      credential,
      '1.4.0',
      [],
      expect.objectContaining({ schemaVersion: 1 }),
      softwareIdentity,
    );
    expect(JSON.stringify(softwareIdentity)).not.toMatch(/path|commit|vault/i);
  });

  it('handles pending, slow-down, and paired without printing secrets', async () => {
    const context = setup([
      { schemaVersion: 1, status: 'authorization_pending', intervalSeconds: 5 },
      { schemaVersion: 1, status: 'slow_down', intervalSeconds: 10 },
      paired,
    ]);
    await context.service.pair({
      origin: 'https://api.tasktwin.example',
      displayName: 'Test Runner',
      platform: 'linux',
      architecture: 'x64',
    });
    expect(await context.store.load()).toMatchObject({
      credential: paired.credential,
      runnerDeviceId: paired.runnerDeviceId,
    });
    const rendered = context.output.join('\n');
    expect(rendered).toContain('ABCD-EFGH-JKMP');
    expect(rendered).not.toContain('D'.repeat(43));
    expect(rendered).not.toContain(paired.credential);
    expect(context.clock.sleep).toHaveBeenNthCalledWith(3, 10_000);
  });

  it.each([
    { schemaVersion: 1, status: 'access_denied' },
    { schemaVersion: 1, status: 'expired' },
  ] as const)('does not save after $status', async (poll) => {
    const context = setup([poll]);
    await expect(
      context.service.pair({
        origin: 'https://api.tasktwin.example',
        displayName: 'Test Runner',
        platform: 'linux',
        architecture: 'x64',
      }),
    ).rejects.toThrow();
    expect(await context.store.load()).toBeNull();
  });

  it('does not report success when credential persistence fails', async () => {
    const context = setup();
    const failingStore = {
      load: vi.fn(),
      clear: vi.fn(),
      save: vi.fn().mockRejectedValue(new CredentialStoreError()),
    };
    const service = new LocalRunnerService(
      failingStore,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      '0.1.0',
    );
    await expect(
      service.pair({
        origin: 'https://api.tasktwin.example',
        displayName: 'Test Runner',
        platform: 'linux',
        architecture: 'x64',
      }),
    ).rejects.toBeInstanceOf(CredentialStoreError);
    expect(context.output.join('\n')).not.toContain('paired successfully');
  });

  it('status and unpair never print the credential', async () => {
    const context = setup();
    const credential: StoredRunnerCredential = {
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    };
    await context.store.save(credential);
    await context.service.status();
    await context.service.unpair();
    expect(await context.store.load()).toBeNull();
    expect(context.output.join('\n')).not.toContain(paired.credential);
  });

  it('does not advertise execution capabilities from a status probe before initialization', async () => {
    const context = setup();
    const credential: StoredRunnerCredential = {
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    };
    await context.store.save(credential);
    const runtime = {
      isReady: () => true,
      currentPin: vi.fn(),
      prepare: vi.fn(),
      refresh: vi.fn(),
      dispose: vi.fn(),
    } as unknown as LocalSecretRuntime;
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      '0.1.0',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      runtime,
      {} as LocalVaultSecretProvider,
    );
    await service.status();
    expect(context.transport.heartbeat).toHaveBeenCalledWith(
      credential,
      '0.1.0',
      [],
      {
        schemaVersion: 1,
        runtimeMode: 'unattended_process',
        autonomyLevel: 'process_unattended',
        serviceStatus: 'not_applicable',
        secretUnlockMode: 'none',
        restartResilient: false,
      },
    );
  });

  it('stops the heartbeat loop after runner authentication is rejected', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    context.transport.heartbeat
      .mockResolvedValueOnce({
        response: {
          schemaVersion: 1,
          runnerDeviceId: paired.runnerDeviceId,
          workspaceId: paired.workspaceId,
          connectionStatus: 'online',
          nextHeartbeatInSeconds: 1,
        },
      })
      .mockRejectedValueOnce(new ControlPlaneClientError(401));
    await context.service.start(new AbortController().signal);
    expect(context.output.join('\n')).toContain('RUNNER_RUNTIME_REVOKED');
    expect(context.transport.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('advertises service and native-secret capabilities only after verified startup', async () => {
    const context = setup();
    const credential: StoredRunnerCredential = {
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    };
    await context.store.save(credential);
    const controller = new AbortController();
    context.transport.heartbeat.mockImplementation(async () => {
      controller.abort();
      return {
        response: {
          schemaVersion: 1,
          runnerDeviceId: paired.runnerDeviceId,
          workspaceId: paired.workspaceId,
          connectionStatus: 'online',
          nextHeartbeatInSeconds: 30,
        },
      };
    });
    const runtime = {
      prepare: vi.fn(),
      refresh: vi.fn(),
      dispose: vi.fn(),
      isReady: () => true,
      isNativeUnlockVerified: () => true,
      secretUnlockMode: () => 'os_native',
      currentPin: () => ({
        schemaVersion: 1,
        vaultId: '53f321f7-ae3a-4707-b9d0-4f617ea116bd',
        vaultRevision: 3,
        inventoryDigest: 'a'.repeat(64),
      }),
    } as LocalSecretRuntime;
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      '0.1.0',
      {} as never,
      {} as never,
      undefined,
      undefined,
      { headed: false, attended: false },
      runtime,
      {} as LocalVaultSecretProvider,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
    );
    await service.start(controller.signal);
    const heartbeatCall = context.transport.heartbeat.mock.calls[0];
    expect(heartbeatCall?.[2]).toEqual(
      expect.arrayContaining([
        'runner_service_v1',
        'scheduled_execution_v1',
        'local_secret_store_v1',
        'os_native_secret_unlock_v1',
      ]),
    );
    expect(heartbeatCall?.[3]).toEqual({
      schemaVersion: 1,
      runtimeMode: 'service',
      autonomyLevel: 'boot_resilient',
      serviceStatus: 'running',
      secretUnlockMode: 'os_native',
      restartResilient: true,
    });
    expect(runtime.prepare).toHaveBeenCalledBefore(context.transport.heartbeat);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('keeps a service online for non-secret work after native unlock failure', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    context.transport.heartbeat.mockImplementation(async () => {
      controller.abort();
      return {
        response: {
          schemaVersion: 1,
          runnerDeviceId: paired.runnerDeviceId,
          workspaceId: paired.workspaceId,
          connectionStatus: 'online',
          nextHeartbeatInSeconds: 30,
        },
      };
    });
    const runtime = {
      prepare: vi.fn(),
      refresh: vi.fn(),
      dispose: vi.fn(),
      isReady: () => false,
      isNativeUnlockVerified: () => false,
      secretUnlockMode: () => 'os_native',
      currentPin: () => undefined,
    } as LocalSecretRuntime;
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      '0.1.0',
      {} as never,
      {} as never,
      undefined,
      undefined,
      { headed: false, attended: false },
      runtime,
      {} as LocalVaultSecretProvider,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
    );
    await service.start(controller.signal);
    const capabilities = context.transport.heartbeat.mock.calls[0]?.[2] ?? [];
    expect(capabilities).toContain('runner_service_v1');
    expect(capabilities).toContain('scheduled_execution_v1');
    expect(capabilities).not.toContain('local_secret_store_v1');
    expect(capabilities).not.toContain('os_native_secret_unlock_v1');
    expect(context.transport.heartbeat.mock.calls[0]?.[3]).toMatchObject({
      autonomyLevel: 'process_unattended',
      serviceStatus: 'degraded',
      secretUnlockMode: 'os_native',
      restartResilient: false,
    });
  });

  it('uses bounded reconnect delay and reconnects after a transient outage', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    context.transport.heartbeat
      .mockRejectedValueOnce(new ControlPlaneClientError(503))
      .mockImplementationOnce(async () => {
        controller.abort();
        return {
          response: {
            schemaVersion: 1,
            runnerDeviceId: paired.runnerDeviceId,
            workspaceId: paired.workspaceId,
            connectionStatus: 'online',
            nextHeartbeatInSeconds: 30,
          },
        };
      });
    await context.service.start(controller.signal);
    expect(context.transport.heartbeat).toHaveBeenCalledTimes(3);
    expect(context.clock.sleep).toHaveBeenCalledWith(
      1_000,
      expect.any(AbortSignal),
    );
    expect(context.output).toContain('CONTROL_PLANE_UNAVAILABLE');
  });

  it('keeps a verifying target locally healthy but claim-disabled while heartbeats continue', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    context.transport.heartbeat.mockImplementation(async () => {
      if (context.transport.heartbeat.mock.calls.length >= 2) {
        controller.abort();
      }
      return {
        response: {
          schemaVersion: 1,
          runnerDeviceId: paired.runnerDeviceId,
          workspaceId: paired.workspaceId,
          connectionStatus: 'online',
          nextHeartbeatInSeconds: 1,
        },
        compatibilityAcknowledgement: 'compatible' as const,
      };
    });
    const claimJob = vi.fn();
    const statuses: RunnerStartupStatus[] = [];
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const runtime = {
      prepare: vi.fn(),
      refresh: vi.fn(),
      dispose: vi.fn(),
      isReady: () => true,
      isNativeUnlockVerified: () => true,
      secretUnlockMode: () => 'os_native',
      currentPin: () => undefined,
    } as LocalSecretRuntime;
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      identity.version,
      { claimJob } as never,
      {} as never,
      undefined,
      undefined,
      { headed: false, attended: false },
      runtime,
      {} as LocalVaultSecretProvider,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-b',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        maintenanceSource: {
          current: async () => ({ state: 'verifying_target' }),
          waitForChange: (signal) =>
            new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else
                signal.addEventListener('abort', () => resolve(), {
                  once: true,
                });
            }),
        },
        startupStatusWriter: {
          write: async (status) => {
            statuses.push(status);
          },
        },
        startupHealthProbe: {
          run: async () => ({
            identity: 'passed',
            instanceLock: 'passed',
            workflowEngine: 'passed',
            policyRuntime: 'passed',
            chromium: 'passed',
            localSecretStore: 'passed',
            nativeSecretAutoUnlock: 'passed',
          }),
        },
        createStartupAttemptId: () => 'startup-b',
      },
    );
    await service.start(controller.signal);
    expect(claimJob).not.toHaveBeenCalled();
    expect(
      context.transport.heartbeat.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activationId: 'release-b',
          startupAttemptId: 'startup-b',
          state: 'healthy',
          acceptsNewJobs: false,
          activeWork: false,
          controlPlaneAcknowledgement: 'compatible',
        }),
      ]),
    );
    expect(JSON.stringify(statuses)).not.toMatch(
      /path|credential|privateKey|vaultId/i,
    );
  });

  it('fails manual-recovery startup before vault or browser health initialization', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const prepare = vi.fn();
    const startupHealth = vi.fn();
    const statuses: RunnerStartupStatus[] = [];
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      identity.version,
      undefined,
      undefined,
      undefined,
      undefined,
      { headed: false, attended: false },
      {
        prepare,
        dispose: vi.fn(),
      } as unknown as LocalSecretRuntime,
      undefined,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-b',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        maintenanceSource: {
          current: async () => ({ state: 'manual_recovery_required' }),
          waitForChange: async () => undefined,
        },
        startupStatusWriter: {
          write: async (status) => {
            statuses.push(status);
          },
        },
        startupHealthProbe: { run: startupHealth },
        createStartupAttemptId: () => 'startup-b',
      },
    );

    await expect(service.start(new AbortController().signal)).rejects.toThrow(
      'manual update recovery',
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(startupHealth).not.toHaveBeenCalled();
    expect(context.transport.heartbeat).not.toHaveBeenCalled();
    expect(statuses).toEqual([
      expect.objectContaining({ state: 'failed', acceptsNewJobs: false }),
    ]);
  });

  it('settles optional missing compatibility acknowledgement after bounded grace', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const claimJob = vi.fn();
    const statuses: RunnerStartupStatus[] = [];
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const signal = new AbortController();
    context.transport.heartbeat.mockImplementation(async () => {
      if (context.transport.heartbeat.mock.calls.length >= 3) signal.abort();
      return {
        response: {
          schemaVersion: 1,
          runnerDeviceId: paired.runnerDeviceId,
          workspaceId: paired.workspaceId,
          connectionStatus: 'online',
          nextHeartbeatInSeconds: 1,
        },
      };
    });
    const waitForChange = (waitSignal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (waitSignal.aborted) resolve();
        else
          waitSignal.addEventListener('abort', () => resolve(), { once: true });
      });
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      identity.version,
      { claimJob } as never,
      {} as never,
      undefined,
      undefined,
      { headed: false, attended: false },
      {
        prepare: vi.fn(),
        refresh: vi.fn(),
        dispose: vi.fn(),
        isReady: () => true,
        isNativeUnlockVerified: () => true,
        secretUnlockMode: () => 'os_native',
        currentPin: () => undefined,
        startupHealth: () => 'ready',
      } as unknown as LocalSecretRuntime,
      undefined,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-b',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        controlPlaneAcknowledgementGraceMilliseconds: 10,
        maintenanceSource: {
          current: async () => ({ state: 'verifying_target' }),
          waitForChange,
        },
        startupStatusWriter: {
          write: async (status) => {
            statuses.push(status);
          },
        },
        startupHealthProbe: {
          run: async () => ({
            identity: 'passed',
            instanceLock: 'passed',
            workflowEngine: 'passed',
            policyRuntime: 'passed',
            chromium: 'passed',
            localSecretStore: 'passed',
            nativeSecretAutoUnlock: 'passed',
          }),
        },
        createStartupAttemptId: () => 'startup-b',
      },
    );

    await service.start(signal.signal);
    expect(
      context.transport.heartbeat.mock.calls.length,
    ).toBeGreaterThanOrEqual(3);
    expect(context.clock.sleep).toHaveBeenCalledWith(
      10,
      expect.any(AbortSignal),
    );
    expect(claimJob).not.toHaveBeenCalled();
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'starting' }),
        expect.objectContaining({
          state: 'healthy',
          acceptsNewJobs: false,
          controlPlaneAcknowledgement: 'not_attempted',
        }),
      ]),
    );
    expect(statuses.some((status) => status.state === 'failed')).toBe(false);
    expect(context.output).not.toContain(
      'RUNNER_STARTUP_COMPATIBILITY_ACK_FAILED',
    );
  });

  it('accepts genuine transport-offline local health without opening claims', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    const ensureRegistered = vi.fn(async () => {
      controller.abort();
      throw new ControlPlaneClientError(null);
    });
    context.transport.heartbeat
      .mockRejectedValueOnce(new ControlPlaneClientError(null))
      .mockImplementation(async () => {
        return {
          response: {
            schemaVersion: 1,
            runnerDeviceId: paired.runnerDeviceId,
            workspaceId: paired.workspaceId,
            connectionStatus: 'online',
            nextHeartbeatInSeconds: 30,
          },
          compatibilityAcknowledgement: 'compatible' as const,
        };
      });
    const statuses: RunnerStartupStatus[] = [];
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const waitForChange = (waitSignal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (waitSignal.aborted) resolve();
        else
          waitSignal.addEventListener('abort', () => resolve(), { once: true });
      });
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      identity.version,
      undefined,
      undefined,
      { ensureRegistered } as never,
      undefined,
      { headed: false, attended: false },
      {
        prepare: vi.fn(),
        refresh: vi.fn(),
        dispose: vi.fn(),
        isReady: () => true,
        isNativeUnlockVerified: () => true,
        secretUnlockMode: () => 'os_native',
        currentPin: () => undefined,
        startupHealth: () => 'ready',
      } as unknown as LocalSecretRuntime,
      undefined,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-b',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        maintenanceSource: {
          current: async () => ({ state: 'verifying_target' }),
          waitForChange,
        },
        startupStatusWriter: {
          write: async (status) => {
            statuses.push(status);
          },
        },
        startupHealthProbe: {
          run: async () => ({
            identity: 'passed',
            instanceLock: 'passed',
            workflowEngine: 'passed',
            policyRuntime: 'passed',
            chromium: 'passed',
            localSecretStore: 'passed',
            nativeSecretAutoUnlock: 'passed',
          }),
        },
        createStartupAttemptId: () => 'startup-b',
      },
    );

    await service.start(controller.signal);
    expect(context.transport.heartbeat).toHaveBeenCalledBefore(
      ensureRegistered,
    );
    expect(ensureRegistered).toHaveBeenCalledOnce();
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'healthy',
          acceptsNewJobs: false,
          controlPlaneAcknowledgement: 'offline',
        }),
      ]),
    );
    expect(context.clock.sleep).not.toHaveBeenCalledWith(
      5_000,
      expect.anything(),
    );
  });

  it('treats repeated temporary Control Plane 503 responses as offline after acknowledgement grace', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    context.transport.heartbeat
      .mockRejectedValueOnce(new ControlPlaneClientError(503))
      .mockRejectedValueOnce(new ControlPlaneClientError(503))
      .mockImplementation(async () => {
        controller.abort();
        return {
          response: {
            schemaVersion: 1,
            runnerDeviceId: paired.runnerDeviceId,
            workspaceId: paired.workspaceId,
            connectionStatus: 'online',
            nextHeartbeatInSeconds: 30,
          },
          compatibilityAcknowledgement: 'compatible' as const,
        };
      });
    const statuses: RunnerStartupStatus[] = [];
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const waitForChange = (waitSignal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (waitSignal.aborted) resolve();
        else
          waitSignal.addEventListener('abort', () => resolve(), { once: true });
      });
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      identity.version,
      undefined,
      undefined,
      undefined,
      undefined,
      { headed: false, attended: false },
      {
        prepare: vi.fn(),
        refresh: vi.fn(),
        dispose: vi.fn(),
        isReady: () => true,
        isNativeUnlockVerified: () => true,
        secretUnlockMode: () => 'os_native',
        currentPin: () => undefined,
        startupHealth: () => 'ready',
      } as unknown as LocalSecretRuntime,
      undefined,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-b',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        controlPlaneAcknowledgementGraceMilliseconds: 10,
        maintenanceSource: {
          current: async () => ({ state: 'verifying_target' }),
          waitForChange,
        },
        startupStatusWriter: {
          write: async (status) => {
            statuses.push(status);
          },
        },
        startupHealthProbe: {
          run: async () => ({
            identity: 'passed',
            instanceLock: 'passed',
            workflowEngine: 'passed',
            policyRuntime: 'passed',
            chromium: 'passed',
            localSecretStore: 'passed',
            nativeSecretAutoUnlock: 'passed',
          }),
        },
        createStartupAttemptId: () => 'startup-b',
      },
    );

    await service.start(controller.signal);
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'healthy',
          acceptsNewJobs: false,
          controlPlaneAcknowledgement: 'offline',
        }),
      ]),
    );
    expect(statuses.some((status) => status.state === 'failed')).toBe(false);
    expect(context.clock.sleep).toHaveBeenCalledWith(
      10,
      expect.any(AbortSignal),
    );
  });

  it('observes maintenance during reconnect backoff and heartbeats draining before acknowledgement', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    let maintenanceState: 'inactive' | 'draining' = 'inactive';
    let publishMaintenance: (() => void) | undefined;
    const events: Array<
      | { readonly type: 'heartbeat'; readonly serviceStatus: string }
      | { readonly type: 'status'; readonly state: string }
    > = [];
    context.transport.heartbeat
      .mockRejectedValueOnce(new ControlPlaneClientError(503))
      .mockImplementation(
        async (_credential, _version, _capabilities, runtime) => {
          events.push({
            type: 'heartbeat',
            serviceStatus: runtime?.serviceStatus ?? 'missing',
          });
          controller.abort();
          return {
            response: {
              schemaVersion: 1,
              runnerDeviceId: paired.runnerDeviceId,
              workspaceId: paired.workspaceId,
              connectionStatus: 'online',
              nextHeartbeatInSeconds: 30,
            },
            compatibilityAcknowledgement: 'compatible' as const,
          };
        },
      );
    const clock: RunnerClock = {
      now: context.clock.now,
      sleep: vi.fn((_milliseconds, waitSignal) => {
        maintenanceState = 'draining';
        publishMaintenance?.();
        return new Promise<void>((resolve) => {
          if (waitSignal?.aborted === true) resolve();
          else
            waitSignal?.addEventListener('abort', () => resolve(), {
              once: true,
            });
        });
      }),
    };
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      clock,
      identity.version,
      undefined,
      undefined,
      undefined,
      undefined,
      { headed: false, attended: false },
      {
        prepare: vi.fn(),
        refresh: vi.fn(),
        dispose: vi.fn(),
        isReady: () => true,
        isNativeUnlockVerified: () => true,
        secretUnlockMode: () => 'os_native',
        currentPin: () => undefined,
        startupHealth: () => 'ready',
      } as unknown as LocalSecretRuntime,
      undefined,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-a',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        maintenanceSource: {
          current: async () => ({ state: maintenanceState }),
          waitForChange: (waitSignal) =>
            new Promise<void>((resolve) => {
              publishMaintenance = resolve;
              if (waitSignal.aborted) resolve();
              else
                waitSignal.addEventListener('abort', () => resolve(), {
                  once: true,
                });
            }),
        },
        startupStatusWriter: {
          write: async (status) => {
            events.push({ type: 'status', state: status.state });
          },
        },
        startupHealthProbe: {
          run: async () => ({
            identity: 'passed',
            instanceLock: 'passed',
            workflowEngine: 'passed',
            policyRuntime: 'passed',
            chromium: 'passed',
            localSecretStore: 'passed',
            nativeSecretAutoUnlock: 'passed',
          }),
        },
        createStartupAttemptId: () => 'startup-a',
      },
    );

    await service.start(controller.signal);
    const drainingHeartbeat = events.findIndex(
      (event) =>
        event.type === 'heartbeat' && event.serviceStatus === 'draining',
    );
    const drainingAcknowledgement = events.findIndex(
      (event) => event.type === 'status' && event.state === 'draining',
    );
    expect(drainingHeartbeat).toBeGreaterThanOrEqual(0);
    expect(drainingAcknowledgement).toBeGreaterThan(drainingHeartbeat);
  });

  it('refreshes maintenance immediately before each claim and closes admission', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    let reads = 0;
    const claimJob = vi.fn();
    context.transport.heartbeat.mockImplementation(
      async (_credential, _version, capabilities, runtime) => {
        const heartbeatNumber = context.transport.heartbeat.mock.calls.length;
        if (heartbeatNumber >= 2) {
          controller.abort();
        }
        if (heartbeatNumber === 1) {
          expect(capabilities).toEqual(
            expect.arrayContaining(['runner_service_v1']),
          );
          expect(runtime?.serviceStatus).toBe('running');
        } else {
          expect(capabilities).toEqual([]);
          expect(runtime?.serviceStatus).toBe('draining');
        }
        return {
          response: {
            schemaVersion: 1,
            runnerDeviceId: paired.runnerDeviceId,
            workspaceId: paired.workspaceId,
            connectionStatus: 'online',
            nextHeartbeatInSeconds: 1,
          },
          compatibilityAcknowledgement: 'compatible' as const,
        };
      },
    );
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      identity.version,
      { claimJob } as never,
      {} as never,
      undefined,
      undefined,
      { headed: false, attended: false },
      {
        prepare: vi.fn(),
        refresh: vi.fn(),
        dispose: vi.fn(),
        isReady: () => true,
        isNativeUnlockVerified: () => true,
        secretUnlockMode: () => 'os_native',
        currentPin: () => undefined,
        startupHealth: () => 'ready',
      } as unknown as LocalSecretRuntime,
      undefined,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-a',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        maintenanceSource: {
          current: async () => ({
            state: reads++ < 3 ? 'inactive' : 'draining',
          }),
          waitForChange: (waitSignal) =>
            new Promise<void>((resolve) => {
              if (waitSignal.aborted) resolve();
              else
                waitSignal.addEventListener('abort', () => resolve(), {
                  once: true,
                });
            }),
        },
        startupStatusWriter: { write: async () => undefined },
        startupHealthProbe: {
          run: async () => ({
            identity: 'passed',
            instanceLock: 'passed',
            workflowEngine: 'passed',
            policyRuntime: 'passed',
            chromium: 'passed',
            localSecretStore: 'passed',
            nativeSecretAutoUnlock: 'passed',
          }),
        },
        createStartupAttemptId: () => 'startup-a',
      },
    );

    await service.start(controller.signal);
    expect(claimJob).not.toHaveBeenCalled();
    expect(
      context.transport.heartbeat.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('heartbeats immediately when maintenance admission becomes unblocked', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    let maintenanceState: 'draining' | 'inactive' = 'draining';
    const reports: Array<{
      readonly capabilities: readonly string[];
      readonly serviceStatus: string;
    }> = [];
    context.transport.heartbeat.mockImplementation(
      async (_credential, _version, capabilities, runtime) => {
        reports.push({
          capabilities: capabilities ?? [],
          serviceStatus: runtime?.serviceStatus ?? 'missing',
        });
        if (reports.length === 1) maintenanceState = 'inactive';
        if (reports.length === 2) controller.abort();
        return {
          response: {
            schemaVersion: 1,
            runnerDeviceId: paired.runnerDeviceId,
            workspaceId: paired.workspaceId,
            connectionStatus: 'online',
            nextHeartbeatInSeconds: 30,
          },
          compatibilityAcknowledgement: 'compatible' as const,
        };
      },
    );
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.4.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      identity.version,
      undefined,
      undefined,
      undefined,
      undefined,
      { headed: false, attended: false },
      {
        prepare: vi.fn(),
        refresh: vi.fn(),
        dispose: vi.fn(),
        isReady: () => true,
        isNativeUnlockVerified: () => true,
        secretUnlockMode: () => 'os_native',
        currentPin: () => undefined,
        startupHealth: () => 'ready',
      } as unknown as LocalSecretRuntime,
      undefined,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-a',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        maintenanceSource: {
          current: async () => ({ state: maintenanceState }),
          waitForChange: (waitSignal) =>
            new Promise<void>((resolve) => {
              if (waitSignal.aborted) resolve();
              else
                waitSignal.addEventListener('abort', () => resolve(), {
                  once: true,
                });
            }),
        },
        startupStatusWriter: { write: async () => undefined },
        startupHealthProbe: {
          run: async () => ({
            identity: 'passed',
            instanceLock: 'passed',
            workflowEngine: 'passed',
            policyRuntime: 'passed',
            chromium: 'passed',
            localSecretStore: 'passed',
            nativeSecretAutoUnlock: 'passed',
          }),
        },
        createStartupAttemptId: () => 'startup-a',
      },
    );

    await service.start(controller.signal);
    expect(reports[0]).toEqual({ capabilities: [], serviceStatus: 'draining' });
    expect(reports[1]).toEqual({
      capabilities: expect.arrayContaining(['runner_service_v1']),
      serviceStatus: 'running',
    });
  });

  it('does not apply target compatibility acknowledgement as a rollback-source gate', async () => {
    const context = setup();
    await context.store.save({
      schemaVersion: 1,
      controlPlaneOrigin: 'https://api.tasktwin.example',
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
      credential: paired.credential,
      savedAt: '2026-07-30T12:00:00.000Z',
    });
    const controller = new AbortController();
    context.transport.heartbeat.mockImplementation(async () => {
      controller.abort();
      return {
        response: {
          schemaVersion: 1,
          runnerDeviceId: paired.runnerDeviceId,
          workspaceId: paired.workspaceId,
          connectionStatus: 'online',
          nextHeartbeatInSeconds: 30,
        },
        compatibilityAcknowledgement: 'update_required' as const,
      };
    });
    const statuses: RunnerStartupStatus[] = [];
    const identity = {
      product: 'tasktwin-runner' as const,
      version: '1.3.0',
      runnerProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
      platform: 'windows' as const,
      architecture: 'x64' as const,
    };
    const service = new LocalRunnerService(
      context.store,
      context.transport as unknown as RunnerControlPlaneTransport,
      { write: (message) => context.output.push(message) },
      context.clock,
      identity.version,
      undefined,
      undefined,
      undefined,
      undefined,
      { headed: false, attended: false },
      {
        prepare: vi.fn(),
        refresh: vi.fn(),
        dispose: vi.fn(),
        isReady: () => true,
        isNativeUnlockVerified: () => true,
        secretUnlockMode: () => 'os_native',
        currentPin: () => undefined,
        startupHealth: () => 'ready',
      } as unknown as LocalSecretRuntime,
      undefined,
      {
        runtimeMode: 'service',
        serviceVerified: true,
        nativeProtectorAvailable: true,
        drainTimeoutMilliseconds: 60_000,
      },
      identity,
      {
        activationId: 'release-a',
        expectedSoftwareIdentity: identity,
        instanceLockHeld: true,
        requireNativeSecretAutoUnlock: true,
        maintenanceSource: {
          current: async () => ({ state: 'rolling_back' }),
          waitForChange: async () => undefined,
        },
        startupStatusWriter: {
          write: async (status) => {
            statuses.push(status);
          },
        },
        startupHealthProbe: {
          run: async () => ({
            identity: 'passed',
            instanceLock: 'passed',
            workflowEngine: 'passed',
            policyRuntime: 'passed',
            chromium: 'passed',
            localSecretStore: 'passed',
            nativeSecretAutoUnlock: 'passed',
          }),
        },
        createStartupAttemptId: () => 'startup-a',
      },
    );

    await service.start(controller.signal);
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'healthy',
          acceptsNewJobs: false,
          controlPlaneAcknowledgement: 'not_attempted',
        }),
      ]),
    );
    expect(context.output).not.toContain(
      'RUNNER_STARTUP_COMPATIBILITY_ACK_FAILED',
    );
  });
});

describe('service shutdown drain', () => {
  it('allows an active run to finish and cancels the unused timeout', async () => {
    let active = true;
    let timeoutCancelled = false;
    const forceCancelActiveRun = vi.fn();
    const result = await drainRunWorker({
      worker: {
        hasActiveRun: () => active,
        waitForActiveRun: async () => {
          active = false;
        },
        forceCancelActiveRun,
      },
      timeoutMilliseconds: 60_000,
      clock: {
        now: () => new Date(),
        sleep: (_milliseconds, signal) =>
          new Promise<void>((_resolve, reject) =>
            signal?.addEventListener(
              'abort',
              () => {
                timeoutCancelled = true;
                reject(new Error('cancelled'));
              },
              { once: true },
            ),
          ),
      },
      output: { write: vi.fn() },
    });
    expect(result).toBe('completed');
    expect(timeoutCancelled).toBe(true);
    expect(forceCancelActiveRun).not.toHaveBeenCalled();
  });

  it('uses safe cancellation after the bounded drain timeout', async () => {
    let active = true;
    let finish: (() => void) | undefined;
    const activeRun = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const output: string[] = [];
    const result = await drainRunWorker({
      worker: {
        hasActiveRun: () => active,
        waitForActiveRun: () => activeRun,
        forceCancelActiveRun: () => {
          active = false;
          finish?.();
        },
      },
      timeoutMilliseconds: 10,
      clock: {
        now: () => new Date(),
        sleep: async () => undefined,
      },
      output: { write: (message) => output.push(message) },
    });
    expect(result).toBe('cancelled');
    expect(output).toEqual(['RUNNER_DRAIN_TIMED_OUT']);
    expect(active).toBe(false);
  });
});
