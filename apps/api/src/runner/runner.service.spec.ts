import { ForbiddenException } from '@nestjs/common';
import {
  RunnerRepositoryError,
  type RunnerRepository,
} from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { RunnerService } from './runner.service.js';

const runner = {
  runnerDeviceId: 'b9d35a01-e29a-4894-bc2c-ea9e6b81c889',
  workspaceId: '2a0c786a-3234-42f0-a3bd-b6d7d76dce1f',
  credentialId: 'a550b35f-fb4c-4a74-bdbe-e306a2f2070b',
};

describe('RunnerService heartbeat', () => {
  it('updates through the repository and returns a bounded interval', async () => {
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const service = new RunnerService({
      heartbeat,
    } as unknown as RunnerRepository);
    await expect(
      service.heartbeat(runner, {
        schemaVersion: 1,
        runnerVersion: '0.1.0',
      }),
    ).resolves.toMatchObject({
      runnerDeviceId: runner.runnerDeviceId,
      connectionStatus: 'online',
      nextHeartbeatInSeconds: 30,
    });
    expect(heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerDeviceId: runner.runnerDeviceId,
        credentialId: runner.credentialId,
        runnerVersion: '0.1.0',
      }),
    );
  });

  it('rejects a runner revoked between guard and update', async () => {
    const service = new RunnerService({
      heartbeat: vi
        .fn()
        .mockRejectedValue(new RunnerRepositoryError('RUNNER_REVOKED')),
    } as unknown as RunnerRepository);
    await expect(
      service.heartbeat(runner, {
        schemaVersion: 1,
        runnerVersion: '0.1.0',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
