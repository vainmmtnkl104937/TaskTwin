import { describe, expect, it, vi } from 'vitest';

import { InMemoryCredentialStore } from '../credential-store.js';
import type { WindowsRunnerServiceManager } from '../platform/windows/windows-service-manager.js';
import { runServiceCli } from './service-cli.js';

const credential = {
  schemaVersion: 1 as const,
  controlPlaneOrigin: 'https://api.tasktwin.example',
  runnerDeviceId: '753ff8fc-4267-4d99-b741-41485f5bab45',
  workspaceId: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
  installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
  credential: 'A'.repeat(43),
  savedAt: '2026-08-10T00:00:00.000Z',
};

describe('local service-management CLI', () => {
  it.each(['install', 'start', 'stop', 'restart', 'uninstall'] as const)(
    'dispatches the fixed %s operation without placing credentials on argv',
    async (operation) => {
      const credentials = new InMemoryCredentialStore();
      await credentials.save(credential);
      const manager = {
        install: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
        uninstall: vi.fn(),
      };
      const output: string[] = [];
      await expect(
        runServiceCli({
          args: [operation],
          credentials,
          manager: manager as unknown as WindowsRunnerServiceManager,
          output: { write: (message) => output.push(message) },
        }),
      ).resolves.toBe(0);
      expect(manager[operation]).toHaveBeenCalledWith(credential.runnerDeviceId);
      expect(JSON.stringify([operation, output])).not.toContain(
        credential.credential,
      );
    },
  );

  it('rejects extra arguments that could be mistaken for credentials or secrets', async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.save(credential);
    await expect(
      runServiceCli({
        args: ['install', '--credential', credential.credential],
        credentials,
        manager: {} as WindowsRunnerServiceManager,
        output: { write: vi.fn() },
      }),
    ).rejects.toThrow('exactly one operation');
  });
});
