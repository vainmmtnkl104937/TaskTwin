import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpRunnerControlPlaneTransport } from './control-plane-client.js';

const credential: StoredRunnerCredential = {
  schemaVersion: 1,
  controlPlaneOrigin: 'https://api.tasktwin.example',
  runnerDeviceId: '753ff8fc-4267-4d99-b741-41485f5bab45',
  workspaceId: 'ad8ca9d9-648e-47c5-8443-408a1308315d',
  installationId: '8bff4d89-91ba-4efd-8927-a4b6e8abec9c',
  credential: 'A'.repeat(43),
  savedAt: '2026-08-10T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP Runner heartbeat compatibility acknowledgement', () => {
  it('parses the optional strict response header separately from the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            runnerDeviceId: credential.runnerDeviceId,
            workspaceId: credential.workspaceId,
            connectionStatus: 'online',
            capabilities: [],
            nextHeartbeatInSeconds: 30,
          }),
          {
            status: 200,
            headers: {
              'TaskTwin-Runner-Compatibility': 'update_recommended',
            },
          },
        ),
      ),
    );
    await expect(
      new HttpRunnerControlPlaneTransport().heartbeat(credential, '1.4.0'),
    ).resolves.toMatchObject({
      response: { schemaVersion: 1, nextHeartbeatInSeconds: 30 },
      compatibilityAcknowledgement: 'update_recommended',
    });
  });

  it('does not trust an unknown compatibility acknowledgement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            runnerDeviceId: credential.runnerDeviceId,
            workspaceId: credential.workspaceId,
            connectionStatus: 'online',
            capabilities: [],
            nextHeartbeatInSeconds: 30,
          }),
          {
            status: 200,
            headers: {
              'TaskTwin-Runner-Compatibility': 'force-compatible',
            },
          },
        ),
      ),
    );
    const result = await new HttpRunnerControlPlaneTransport().heartbeat(
      credential,
      '1.4.0',
    );
    expect(result).not.toHaveProperty('compatibilityAcknowledgement');
  });
});
