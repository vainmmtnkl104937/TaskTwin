import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { RunnerRepository } from '../src/runner/runner.repository.js';

const runnerDeviceId = '00000000-0000-4000-8000-000000000005';
const credentialId = '00000000-0000-4000-8000-000000000006';
const now = new Date('2026-08-09T08:00:00.000Z');

function createRepository() {
  const runnerUpdate = vi.fn(async () => undefined);
  const transaction = {
    $queryRaw: vi.fn(async () => [{ now }]),
    runnerDevice: {
      findUnique: vi.fn(async () => ({
        revokedAt: null,
        workspaceId: '00000000-0000-4000-8000-000000000002',
        runnerVersion: '0.1.0',
        platform: 'win32',
        architecture: 'x64',
        runProtocolVersion: 2,
        workflowSchemaVersion: 1,
        localStateSchemaVersion: 1,
        softwareMetadataRevision: 1,
        runtimeMode: null,
        autonomyLevel: null,
        serviceStatus: null,
        secretUnlockMode: null,
        restartResilient: null,
        runtimeMetadataRevision: 0,
        credential: { id: credentialId, revokedAt: null },
      })),
      update: runnerUpdate,
    },
    runnerCredential: {
      update: vi.fn(async () => undefined),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  } as unknown as PrismaClient;
  return { repository: new RunnerRepository(prisma), runnerUpdate };
}

describe('RunnerRepository heartbeat compatibility acknowledgement', () => {
  it('derives compatible from the identity accepted in the same transaction', async () => {
    const test = createRepository();

    await expect(
      test.repository.heartbeat({
        runnerDeviceId,
        credentialId,
        runnerVersion: '0.1.0',
        softwareIdentity: {
          product: 'tasktwin-runner',
          version: '0.1.0',
          runnerProtocolVersion: 2,
          workflowSchemaVersion: 1,
          localStateSchemaVersion: 1,
          platform: 'windows',
          architecture: 'x64',
        },
        capabilities: [],
        now,
      }),
    ).resolves.toEqual({
      runtime: null,
      compatibility: { status: 'compatible', reasons: [] },
    });
    expect(test.runnerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runProtocolVersion: 2,
          workflowSchemaVersion: 1,
          localStateSchemaVersion: 1,
        }),
      }),
    );
  });

  it('acknowledges an accepted legacy heartbeat as update-required', async () => {
    const test = createRepository();

    await expect(
      test.repository.heartbeat({
        runnerDeviceId,
        credentialId,
        runnerVersion: '0.1.0',
        capabilities: [],
        now,
      }),
    ).resolves.toMatchObject({
      compatibility: {
        status: 'update_required',
        reasons: ['software_identity_missing'],
      },
    });
  });
});
