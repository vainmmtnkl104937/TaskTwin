import { BadRequestException, ConflictException } from '@nestjs/common';
import type { RunnerRolloutRepository } from '@tasktwin/database';
import { RunnerRolloutRepositoryError } from '@tasktwin/database';
import { describe, expect, it, vi } from 'vitest';

import { RunnerRolloutService } from './runner-rollout.service.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const releaseId = '00000000-0000-4000-8000-000000000002';
const runnerId = '00000000-0000-4000-8000-000000000003';

describe('RunnerRolloutService', () => {
  it('accepts explicit stages and creates a deterministic request digest', async () => {
    const create = vi.fn().mockResolvedValue({ idempotent: false });
    const service = new RunnerRolloutService({
      create,
    } as unknown as RunnerRolloutRepository);
    await service.create('user-id', workspaceId, {
      clientRolloutId: '00000000-0000-4000-8000-000000000004',
      targetReleaseId: releaseId,
      stages: [{ stageNumber: 1, runnerDeviceIds: [runnerId] }],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          workspaceId,
          targetReleaseId: releaseId,
        }),
        requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('rejects duplicate Runner membership before persistence', async () => {
    const service = new RunnerRolloutService({
      create: vi.fn(),
    } as unknown as RunnerRolloutRepository);
    await expect(
      service.create('user-id', workspaceId, {
        clientRolloutId: '00000000-0000-4000-8000-000000000004',
        targetReleaseId: releaseId,
        stages: [
          { stageNumber: 1, runnerDeviceIds: [runnerId] },
          { stageNumber: 2, runnerDeviceIds: [runnerId] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps active assignment conflicts without emitting any Runner action', async () => {
    const activateStage = vi
      .fn()
      .mockRejectedValue(
        new RunnerRolloutRepositoryError('RUNNER_ACTIVE_ROLLOUT_CONFLICT'),
      );
    const service = new RunnerRolloutService({
      activateStage,
    } as unknown as RunnerRolloutRepository);
    await expect(
      service.activateStage('user-id', releaseId, '1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(JSON.stringify(activateStage.mock.calls)).not.toMatch(
      /downloadUrl|artifactBytes|powershell|shellCommand|updateCommand/i,
    );
  });
});
