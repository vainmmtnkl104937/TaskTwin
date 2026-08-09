import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import { describe, expect, it, vi } from 'vitest';

import type { RunnerControlPlaneTransport } from '../control-plane-client.js';
import type { NoEchoPrompt } from './no-echo-prompt.js';
import type { LocalSecretVaultService } from './local-secret-vault-service.js';
import { RunnerLocalSecretRuntime } from './local-secret-runtime.js';

const credential: StoredRunnerCredential = {
  schemaVersion: 1,
  controlPlaneOrigin: 'https://api.tasktwin.example',
  runnerDeviceId: '753ff8fc-4267-4d99-b741-41485f5bab45',
  workspaceId: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
  installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
  credential: 'A'.repeat(43),
  savedAt: '2026-08-09T00:00:00.000Z',
};

describe('Runner local-secret startup reporting', () => {
  it('keeps no-vault local health available when Control Plane status sync is offline', async () => {
    const synchronizeSecretInventory = vi
      .fn()
      .mockRejectedValue(new Error('Control Plane offline'));
    const runtime = new RunnerLocalSecretRuntime(
      {
        status: vi.fn().mockResolvedValue({
          status: 'unavailable',
          vaultRevision: null,
          configuredSecretCount: 0,
          synchronized: false,
        }),
        dispose: vi.fn(),
      } as unknown as LocalSecretVaultService,
      {
        isAvailable: () => false,
        read: vi.fn(),
      } as unknown as NoEchoPrompt,
      { synchronizeSecretInventory } as unknown as RunnerControlPlaneTransport,
      { write: vi.fn() },
      'service',
    );

    await expect(
      runtime.prepare(credential, new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(runtime.startupHealth()).toBe('unavailable');
    expect(synchronizeSecretInventory).toHaveBeenCalledOnce();
  });
});
