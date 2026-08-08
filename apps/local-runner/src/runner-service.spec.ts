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
import { LocalRunnerService, type RunnerClock } from './runner-service.js';
import type { LocalSecretRuntime } from './secrets/local-secret-runtime.js';
import type { LocalVaultSecretProvider } from './secrets/local-vault-secret-provider.js';

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
      schemaVersion: 1,
      runnerDeviceId: paired.runnerDeviceId,
      workspaceId: paired.workspaceId,
      connectionStatus: 'online',
      nextHeartbeatInSeconds: 30,
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

  it('advertises local_secret_store_v1 only for a ready synchronized runtime with a provider', async () => {
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
      ['local_secret_store_v1'],
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
        schemaVersion: 1,
        runnerDeviceId: paired.runnerDeviceId,
        workspaceId: paired.workspaceId,
        connectionStatus: 'online',
        nextHeartbeatInSeconds: 1,
      })
      .mockRejectedValueOnce(new ControlPlaneClientError(401));
    await context.service.start(new AbortController().signal);
    expect(context.output.join('\n')).toContain('heartbeat stopped');
    expect(context.transport.heartbeat).toHaveBeenCalledTimes(2);
  });
});
