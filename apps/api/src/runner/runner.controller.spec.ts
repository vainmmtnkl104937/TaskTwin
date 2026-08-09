import { describe, expect, it, vi } from 'vitest';

import { RunnerJobsController } from '../runner-jobs/runner-jobs.controller.js';
import { RUNNER_COMPATIBILITY_HEADER } from '@tasktwin/runner-protocol';
import { RunnerController } from './runner.controller.js';
import type { RunnerService } from './runner.service.js';

const runner = {
  runnerDeviceId: 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889',
  workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
  credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
};

describe('RunnerController heartbeat acknowledgement', () => {
  it('returns the unchanged strict body and a bounded compatibility header', async () => {
    const response = {
      schemaVersion: 1 as const,
      runnerDeviceId: runner.runnerDeviceId,
      workspaceId: runner.workspaceId,
      connectionStatus: 'online' as const,
      capabilities: [],
      nextHeartbeatInSeconds: 30,
    };
    const heartbeat = vi.fn().mockResolvedValue({
      response,
      compatibilityStatus: 'update_recommended',
    });
    const controller = new RunnerController({
      heartbeat,
    } as unknown as RunnerService);
    const headers = { setHeader: vi.fn() };

    await expect(
      controller.heartbeat(runner, { schemaVersion: 1 }, headers),
    ).resolves.toEqual(response);
    expect(headers.setHeader).toHaveBeenCalledWith(
      RUNNER_COMPATIBILITY_HEADER,
      'update_recommended',
    );
    expect(JSON.stringify(response)).not.toContain('compatibilityStatus');
  });

  it('exposes no remote update, rollback, installation, download, command, or shell operation', () => {
    const exposedMethods = [RunnerController, RunnerJobsController].flatMap(
      (controller) => Object.getOwnPropertyNames(controller.prototype),
    );

    expect(exposedMethods.join(' ')).not.toMatch(
      /update|upgrade|rollback|install|download|shell|apply|execute|command/i,
    );
  });
});
