import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { DEFAULT_WORKSPACE_EXECUTION_POLICY } from '@tasktwin/workflow-policy';
import { describe, expect, it, vi } from 'vitest';

vi.mock(
  '../src/audit-trail/audit-appender.repository.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../src/audit-trail/audit-appender.repository.js')
      >();
    return {
      ...actual,
      appendAuditEventTransactional: vi.fn().mockResolvedValue(undefined),
    };
  },
);

import {
  OrganizationRole,
  type PrismaClient,
} from '../src/generated/prisma/client.js';
import { WorkflowLifecycleRepository } from '../src/workflow-lifecycle/workflow-lifecycle.repository.js';

const actorUserId = '7c50dc9a-0ec3-4115-86ca-ce2f85cac459';
const workflowId = '6e8921f3-2db3-49c5-ae9c-b754739ba02a';
const versionId = 'd7237734-c045-41ee-b07a-c184dd24a36e';

function definition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId,
    version: 1,
    name: 'Lifecycle workflow',
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'step-1',
        type: 'wait',
        name: 'Wait',
        durationMs: 100,
      },
    ],
  };
}

function detailRow(
  status: 'draft' | 'testing' | 'published' | 'archived',
  role: OrganizationRole = OrganizationRole.ADMIN,
) {
  return {
    id: versionId,
    workflowId,
    version: 1,
    revision: 4,
    status,
    schemaVersion: 1,
    definition: definition(),
    createdFromVersionId: null,
    clientCreationId: null,
    publishedAt: null,
    publishedById: null,
    archivedAt: null,
    archivedById: null,
    createdAt: new Date('2026-07-30T10:00:00.000Z'),
    updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    recordingConversion: null,
    workflow: {
      workspaceId: '4132fd4a-2f54-4da6-9400-df79d634c292',
      workspace: {
        organization: {
          members: [
            {
              userId: actorUserId,
              organizationId: '2958218d-e60f-4e34-b355-7e2cf5e807d7',
              role,
            },
          ],
        },
      },
    },
  };
}

function createRepository(transaction: Record<string, unknown>) {
  const prisma = {
    $transaction: vi.fn(
      async (
        operation: (client: Record<string, unknown>) => Promise<unknown>,
      ) => operation(transaction),
    ),
  };
  return {
    repository: new WorkflowLifecycleRepository(
      prisma as unknown as PrismaClient,
    ),
    prisma,
  };
}

describe('WorkflowLifecycleRepository', () => {
  it('submits a ready Draft by changing status only', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(detailRow('draft', OrganizationRole.MEMBER))
      .mockResolvedValueOnce(detailRow('testing', OrganizationRole.MEMBER));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { repository } = createRepository({
      workflowVersion: {
        findFirst,
        findMany: vi.fn().mockResolvedValue([]),
        updateMany,
      },
      workspaceExecutionPolicyVersion: {
        findFirst: vi.fn().mockResolvedValue({
          definition: DEFAULT_WORKSPACE_EXECUTION_POLICY,
        }),
      },
    });

    const result = await repository.submitForTesting(actorUserId, versionId, 4);

    expect(result.workflowVersion.status).toBe('testing');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: versionId, status: 'draft', revision: 4 },
      data: { status: 'testing' },
    });
    expect(updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('definition');
    expect(updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('revision');
  });

  it('archives the current Published version and publishes the candidate atomically', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(detailRow('testing'))
      .mockResolvedValueOnce(detailRow('testing'))
      .mockResolvedValueOnce(detailRow('published'));
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: workflowId }]),
      workflowVersion: {
        findFirst,
        findMany: vi.fn().mockResolvedValue([]),
        updateMany,
      },
      workspaceExecutionPolicyVersion: {
        findFirst: vi.fn().mockResolvedValue({
          definition: DEFAULT_WORKSPACE_EXECUTION_POLICY,
        }),
      },
    };
    const { repository, prisma } = createRepository(transaction);
    const occurredAt = new Date('2026-07-30T12:00:00.000Z');

    const result = await repository.publish(
      actorUserId,
      versionId,
      4,
      occurredAt,
    );

    expect(result.workflowVersion.status).toBe('published');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        workflowId,
        status: 'published',
        id: { not: versionId },
      },
      data: {
        status: 'archived',
        archivedAt: occurredAt,
        archivedById: actorUserId,
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: versionId, status: 'testing', revision: 4 },
      data: {
        status: 'published',
        publishedAt: occurredAt,
        publishedById: actorUserId,
      },
    });
  });

  it('returns the same Draft for an idempotent creation retry', async () => {
    const clientCreationId = '4a892223-8909-4d26-baa4-133da9c021a2';
    const workflowFindFirst = vi.fn().mockResolvedValue({
      id: workflowId,
      workspace: {
        organization: {
          members: [{ role: OrganizationRole.MEMBER }],
        },
      },
    });
    const versionFindFirst = vi
      .fn()
      .mockResolvedValue(detailRow('draft', OrganizationRole.MEMBER));
    const versionFindUnique = vi.fn().mockResolvedValue({
      id: versionId,
      createdFromVersionId: '31be5927-c067-421e-917d-bf533c934a0f',
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: workflowId }]),
      workflow: { findFirst: workflowFindFirst },
      workflowVersion: {
        findFirst: versionFindFirst,
        findUnique: versionFindUnique,
      },
    };
    const { repository } = createRepository(transaction);

    const result = await repository.createDraftVersion(
      actorUserId,
      workflowId,
      '31be5927-c067-421e-917d-bf533c934a0f',
      clientCreationId,
      new Date('2026-07-30T12:00:00.000Z'),
    );

    expect(result.idempotent).toBe(true);
    expect(result.workflowVersion.id).toBe(versionId);
    expect(versionFindUnique).toHaveBeenCalledWith({
      where: { workflowId_clientCreationId: { workflowId, clientCreationId } },
      select: { id: true, createdFromVersionId: true },
    });
  });
});
