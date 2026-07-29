import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { describe, expect, it, vi } from 'vitest';

import {
  OrganizationRole,
  type PrismaClient,
} from '../src/generated/prisma/client.js';
import { WorkflowDraftRepository } from '../src/workflow-draft/workflow-draft.repository.js';

const actorUserId = '7c50dc9a-0ec3-4115-86ca-ce2f85cac459';
const workflowVersionId = 'd7237734-c045-41ee-b07a-c184dd24a36e';

function definition(name = 'Draft'): WorkflowDefinition {
  return {
    schemaVersion: 1,
    workflowId: 'workflow-session-11',
    version: 1,
    name,
    status: 'draft',
    variables: [],
    steps: [
      {
        id: 'step-1',
        type: 'wait',
        name: 'Wait',
        durationMs: 500,
      },
    ],
  };
}

function detailRow(
  role: OrganizationRole = OrganizationRole.MEMBER,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: workflowVersionId,
    workflowId: 'workflow-session-11',
    version: 1,
    revision: 1,
    status: 'draft',
    schemaVersion: 1,
    definition: definition(),
    updatedAt: new Date('2026-07-29T20:00:00.000Z'),
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
    ...overrides,
  };
}

function createRepository(current = detailRow()) {
  const updated = detailRow(OrganizationRole.MEMBER, {
    revision: 2,
    definition: definition('Updated'),
  });
  const transaction = {
    workflowVersion: {
      findFirst: vi.fn().mockResolvedValue(current),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ revision: 2 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
    },
    workflow: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  } as unknown as PrismaClient;

  return {
    repository: new WorkflowDraftRepository(prisma),
    prisma,
    transaction,
  };
}

describe('WorkflowDraftRepository', () => {
  it('updates definition and metadata in one transaction and increments revision', async () => {
    const { repository, prisma, transaction } = createRepository();

    const result = await repository.updateDraft(
      actorUserId,
      workflowVersionId,
      1,
      definition('Updated'),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.workflowVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: workflowVersionId,
        status: 'draft',
        revision: 1,
      },
      data: {
        definition: definition('Updated'),
        revision: { increment: 1 },
      },
    });
    expect(transaction.workflow.update).toHaveBeenCalledWith({
      where: { id: 'workflow-session-11' },
      data: { name: 'Updated', description: null },
    });
    expect(result.workflowVersion.revision).toBe(2);
  });

  it('rejects stale revisions before writing', async () => {
    const { repository, transaction } = createRepository(
      detailRow(OrganizationRole.MEMBER, { revision: 3 }),
    );

    await expect(
      repository.updateDraft(
        actorUserId,
        workflowVersionId,
        1,
        definition('Stale'),
      ),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_DRAFT_REVISION_CONFLICT',
      currentRevision: 3,
    });
    expect(transaction.workflowVersion.updateMany).not.toHaveBeenCalled();
  });

  it('keeps VIEWER read-only and rejects non-draft versions', async () => {
    const viewer = createRepository(detailRow(OrganizationRole.VIEWER));
    await expect(
      viewer.repository.updateDraft(
        actorUserId,
        workflowVersionId,
        1,
        definition(),
      ),
    ).rejects.toMatchObject({ code: 'WORKFLOW_DRAFT_FORBIDDEN' });

    const published = createRepository(
      detailRow(OrganizationRole.MEMBER, { status: 'published' }),
    );
    await expect(
      published.repository.updateDraft(
        actorUserId,
        workflowVersionId,
        1,
        definition(),
      ),
    ).rejects.toMatchObject({ code: 'WORKFLOW_VERSION_NOT_DRAFT' });
  });

  it('rejects workflow identity and version mutations', async () => {
    const { repository } = createRepository();

    await expect(
      repository.updateDraft(actorUserId, workflowVersionId, 1, {
        ...definition(),
        workflowId: 'changed',
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_ID_IMMUTABLE' });
    await expect(
      repository.updateDraft(actorUserId, workflowVersionId, 1, {
        ...definition(),
        version: 2,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_VERSION_IMMUTABLE' });
  });

  it('rejects unknown variable references before opening a transaction', async () => {
    const { repository, prisma } = createRepository();
    const invalid = definition();
    invalid.steps = [
      {
        id: 'step-1',
        type: 'fill',
        name: 'Invalid fill',
        locator: { kind: 'label', value: 'Email' },
        value: { kind: 'variable', variableName: 'missingVariable' },
      },
    ];

    await expect(
      repository.updateDraft(actorUserId, workflowVersionId, 1, invalid),
    ).rejects.toMatchObject({ code: 'WORKFLOW_DEFINITION_INVALID' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('propagates metadata failure so the transaction can roll back', async () => {
    const { repository, transaction } = createRepository();
    transaction.workflow.update.mockRejectedValueOnce(
      new Error('simulated metadata failure'),
    );

    await expect(
      repository.updateDraft(
        actorUserId,
        workflowVersionId,
        1,
        definition('Rollback'),
      ),
    ).rejects.toThrow('simulated metadata failure');
    expect(
      transaction.workflowVersion.findUniqueOrThrow,
    ).not.toHaveBeenCalled();
  });
});
