import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { WorkflowRunRepository } from '../src/workflow-run/workflow-run.repository.js';

const runnerDeviceId = '00000000-0000-4000-8000-000000000005';

function createRepository(input: {
  serviceStatus: 'running' | 'draining';
  revokedAt?: Date | null;
}) {
  const workflowRunFindUnique = vi.fn(async () => null);
  const workflowRunFindFirst = vi.fn(async () => null);
  const transaction = {
    $queryRaw: vi.fn(async () => []),
    runnerDevice: {
      findUnique: vi.fn(async () => ({
        revokedAt: input.revokedAt ?? null,
        runnerVersion: '0.1.0',
        platform: 'win32',
        architecture: 'x64',
        runProtocolVersion: 2,
        workflowSchemaVersion: 1,
        localStateSchemaVersion: 1,
        serviceStatus: input.serviceStatus,
        secretInventory: null,
      })),
    },
    workflowRun: {
      findUnique: workflowRunFindUnique,
      findFirst: workflowRunFindFirst,
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  } as unknown as PrismaClient;
  return {
    repository: new WorkflowRunRepository(prisma),
    workflowRunFindUnique,
    workflowRunFindFirst,
  };
}

const claimInput = {
  runnerDeviceId,
  runnerVersion: '0.1.0',
  runProtocolVersion: 2,
  workflowSchemaVersion: 1,
  claimAttemptId: '00000000-0000-4000-8000-000000000022',
  leaseTokenHash: 'a'.repeat(64),
  now: new Date('2026-08-09T08:00:00.000Z'),
  leaseExpiresAt: new Date('2026-08-09T08:01:00.000Z'),
};

describe('WorkflowRunRepository maintenance claim defense', () => {
  it('returns no job before active or queued selection while draining', async () => {
    const test = createRepository({ serviceStatus: 'draining' });

    await expect(test.repository.claim(claimInput)).resolves.toEqual({
      status: 'no_job',
    });
    expect(test.workflowRunFindUnique).toHaveBeenCalledOnce();
    expect(test.workflowRunFindFirst).not.toHaveBeenCalled();
  });

  it('continues through ordinary claim selection when service is running', async () => {
    const test = createRepository({ serviceStatus: 'running' });
    await expect(test.repository.claim(claimInput)).resolves.toEqual({
      status: 'no_job',
    });
    expect(test.workflowRunFindUnique).toHaveBeenCalledOnce();
  });

  it('preserves revocation precedence over maintenance compatibility', async () => {
    const test = createRepository({
      serviceStatus: 'draining',
      revokedAt: new Date('2026-08-09T07:59:00.000Z'),
    });

    await expect(test.repository.claim(claimInput)).rejects.toMatchObject({
      code: 'RUNNER_REVOKED',
    });
  });
});
