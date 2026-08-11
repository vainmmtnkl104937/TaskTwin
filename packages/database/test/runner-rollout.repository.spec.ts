import { describe, expect, it, vi } from 'vitest';

import type { ReleaseManifest } from '@tasktwin/runner-release';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { RunnerRolloutRepository } from '../src/runner-rollout/runner-rollout.repository.js';

vi.mock('../src/audit-trail/audit-appender.repository.js', () => ({
  appendAuditEventTransactional: vi.fn(async () => ({
    event: { id: 'audit-id' },
    idempotent: false,
  })),
}));

const workspaceId = '00000000-0000-4000-8000-000000000001';
const releaseId = '00000000-0000-4000-8000-000000000002';
const rolloutId = '00000000-0000-4000-8000-000000000003';
const stageId = '00000000-0000-4000-8000-000000000004';
const runnerId = '00000000-0000-4000-8000-000000000005';
const assignmentId = '00000000-0000-4000-8000-000000000006';

const manifest: ReleaseManifest = {
  schemaVersion: 1,
  product: 'tasktwin-runner',
  version: '1.2.3',
  channel: 'stable',
  sourceCommit: 'a'.repeat(40),
  builtAt: '2026-08-11T00:00:00.000Z',
  compatibility: {
    runnerProtocolVersion: 2,
    workflowSchema: { readable: { min: 1, max: 1 } },
    localState: { readableSchemas: [1], writableSchema: 1 },
    localSecretVault: {
      readableSchemas: [1],
      writableSchema: 1,
      readableProtectionProfiles: ['windows_dpapi_ng_machine_v1'],
    },
  },
  artifacts: [
    {
      platform: 'windows',
      architecture: 'x64',
      fileName: 'tasktwin-runner-1.2.3-windows-x64.zip',
      archiveFormat: 'zip',
      sizeBytes: 10,
      sha256: 'b'.repeat(64),
    },
  ],
  signingKeyId: 'repository-test-key',
};

function resultRecord(stageStatus: 'pending' | 'active') {
  const now = new Date('2026-08-11T10:00:00.000Z');
  return {
    id: rolloutId,
    workspaceId,
    targetReleaseId: releaseId,
    clientRolloutId: '00000000-0000-4000-8000-000000000007',
    requestDigest: 'c'.repeat(64),
    status: 'active' as const,
    reviewReason: null,
    createdByUserId: '00000000-0000-4000-8000-000000000008',
    activatedByUserId: null,
    pausedByUserId: null,
    cancelledByUserId: null,
    activatedAt: now,
    pausedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    targetRelease: {
      id: releaseId,
      product: 'tasktwin-runner',
      version: '1.2.3',
      status: 'available' as const,
    },
    stages: [
      {
        id: stageId,
        rolloutId,
        stageNumber: 1,
        status: stageStatus,
        reviewReason: null,
        activatedByUserId: null,
        activatedAt: stageStatus === 'active' ? now : null,
        completedAt: null,
        failedReviewAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
        assignments: [
          {
            id: assignmentId,
            rolloutId,
            stageId,
            runnerDeviceId: runnerId,
            status: stageStatus === 'active' ? 'target_assigned' : 'pending',
            baselineVersion: stageStatus === 'active' ? '1.0.0' : null,
            lastObservedVersion: stageStatus === 'active' ? '1.0.0' : null,
            lastObservedAt: stageStatus === 'active' ? now : null,
            assignedAt: stageStatus === 'active' ? now : null,
            convergedAt: null,
            rolledBackAt: null,
            failedAt: null,
            cancelledAt: null,
            createdAt: now,
            updatedAt: now,
            runnerDevice: { displayName: 'Canary Runner' },
          },
        ],
      },
    ],
  };
}

function activationFixture(input?: {
  stageStatus?: 'pending' | 'active';
  revoked?: boolean;
  platform?: string;
  desiredAssignmentId?: string | null;
}) {
  const stageStatus = input?.stageStatus ?? 'pending';
  const current = resultRecord(stageStatus);
  const runnerDeviceUpdate = vi.fn(async () => undefined);
  const assignmentUpdate = vi.fn(async () => undefined);
  const stageUpdate = vi.fn(async () => undefined);
  const transaction = {
    organizationMember: {
      findFirst: vi.fn(async () => ({ userId: current.createdByUserId })),
    },
    runnerReleaseRollout: {
      findUnique: vi.fn(async () => ({
        ...current,
        targetRelease: { ...current.targetRelease, manifest },
        stages: current.stages.map((stage) => ({
          ...stage,
          assignments: stage.assignments.map((assignment) => ({
            ...assignment,
            runnerDevice: {
              id: runnerId,
              workspaceId,
              displayName: 'Canary Runner',
              platform: input?.platform ?? 'win32',
              architecture: 'x64',
              runnerVersion: '1.0.0',
              revokedAt: input?.revoked ? new Date() : null,
              desiredRolloutAssignmentId:
                input?.desiredAssignmentId === undefined
                  ? null
                  : input.desiredAssignmentId,
            },
          })),
        })),
      })),
      findUniqueOrThrow: vi.fn(async () => resultRecord('active')),
    },
    runnerDevice: { update: runnerDeviceUpdate },
    runnerReleaseRolloutAssignment: { update: assignmentUpdate },
    runnerReleaseRolloutStage: { update: stageUpdate },
  };
  const transactionCall = vi.fn(
    async (operation: (tx: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
  );
  const repository = new RunnerRolloutRepository({
    $transaction: transactionCall,
  } as unknown as PrismaClient);
  return {
    repository,
    transaction,
    transactionCall,
    runnerDeviceUpdate,
    assignmentUpdate,
    stageUpdate,
  };
}

describe('RunnerRolloutRepository stage activation', () => {
  it('sets desired release metadata and assignment state without an update command', async () => {
    const fixture = activationFixture();

    await fixture.repository.activateStage({
      actorUserId: '00000000-0000-4000-8000-000000000008',
      rolloutId,
      stageNumber: 1,
    });

    expect(fixture.runnerDeviceUpdate).toHaveBeenCalledWith({
      where: { id: runnerId },
      data: expect.objectContaining({
        desiredReleaseId: releaseId,
        desiredRolloutAssignmentId: assignmentId,
      }),
    });
    expect(fixture.assignmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'target_assigned' }),
      }),
    );
    expect(fixture.stageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'active' }),
      }),
    );
    expect(JSON.stringify(fixture.runnerDeviceUpdate.mock.calls)).not.toMatch(
      /command|download|artifactBytes|powershell|install|rollback/i,
    );
  });

  it.each([
    ['revoked Runner', { revoked: true }, 'RUNNER_REVOKED'],
    [
      'platform mismatch',
      { platform: 'linux' },
      'RUNNER_PLATFORM_INCOMPATIBLE',
    ],
    [
      'active assignment conflict',
      { desiredAssignmentId: '00000000-0000-4000-8000-000000000099' },
      'RUNNER_ACTIVE_ROLLOUT_CONFLICT',
    ],
  ] as const)(
    'rejects %s without assigning desired state',
    async (_label, options, code) => {
      const fixture = activationFixture(options);

      await expect(
        fixture.repository.activateStage({
          actorUserId: '00000000-0000-4000-8000-000000000008',
          rolloutId,
          stageNumber: 1,
        }),
      ).rejects.toMatchObject({ code });
      expect(fixture.runnerDeviceUpdate).not.toHaveBeenCalled();
    },
  );

  it('retries serialization races and returns an already-active stage idempotently', async () => {
    const fixture = activationFixture({ stageStatus: 'active' });
    fixture.transactionCall
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('serialization conflict', {
          code: 'P2034',
          clientVersion: '7.9.1',
        }),
      )
      .mockImplementationOnce(
        async (
          operation: (tx: typeof fixture.transaction) => Promise<unknown>,
        ) => operation(fixture.transaction),
      );

    await expect(
      fixture.repository.activateStage({
        actorUserId: '00000000-0000-4000-8000-000000000008',
        rolloutId,
        stageNumber: 1,
      }),
    ).resolves.toMatchObject({ status: 'active' });
    expect(fixture.transactionCall).toHaveBeenCalledTimes(2);
    expect(fixture.runnerDeviceUpdate).not.toHaveBeenCalled();
  });

  it('rejects an early next stage through deterministic ordering', async () => {
    const fixture = activationFixture();
    const initial = await fixture.transaction.runnerReleaseRollout.findUnique();
    if (initial === null) throw new Error('fixture unavailable');
    initial.stages = [
      { ...initial.stages[0]!, stageNumber: 1, status: 'active' },
      { ...initial.stages[0]!, id: `${stageId.slice(0, -1)}9`, stageNumber: 2 },
    ];
    fixture.transaction.runnerReleaseRollout.findUnique.mockResolvedValueOnce(
      initial,
    );

    await expect(
      fixture.repository.activateStage({
        actorUserId: '00000000-0000-4000-8000-000000000008',
        rolloutId,
        stageNumber: 2,
      }),
    ).rejects.toThrow(/previous stage/i);
    expect(fixture.runnerDeviceUpdate).not.toHaveBeenCalled();
  });
});
