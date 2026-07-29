import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { WorkflowVersionRepository } from '../src/workflow-version.repository.js';

async function readValidWorkflowFixture(): Promise<unknown> {
  const fixtureUrl = new URL(
    '../../workflow-schema/fixtures/valid-workflow.v1.json',
    import.meta.url,
  );

  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown;
}

describe('WorkflowVersionRepository', () => {
  it('validates a workflow before creating its immutable version record', async () => {
    const definition = await readValidWorkflowFixture();
    const persistedVersion = {
      id: 'd6eec35b-0ca5-4d63-84a3-83c45986b796',
      workflowId: 'exampleCheckout',
      version: 1,
      status: 'draft' as const,
      schemaVersion: 1,
      definition: definition as Prisma.JsonValue,
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    };
    const findUnique = vi.fn().mockResolvedValue(null);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(persistedVersion);
    const transactionClient = {
      workflow: { findUnique, upsert },
      workflowVersion: { create },
    } as unknown as Prisma.TransactionClient;
    const transaction = vi
      .fn()
      .mockImplementation(
        async (
          operation: (
            client: Prisma.TransactionClient,
          ) => Promise<PersistedVersionResult>,
        ) => operation(transactionClient),
      );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaClient;
    const repository = new WorkflowVersionRepository(prisma);

    await expect(
      repository.create('7778ece0-8fa8-4ce7-9961-c08444ac57fc', definition),
    ).resolves.toEqual(persistedVersion);
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: '7778ece0-8fa8-4ce7-9961-c08444ac57fc',
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: 'exampleCheckout',
        version: 1,
        schemaVersion: 1,
      }),
    });
  });

  it('rejects invalid workflow JSON before opening a transaction', async () => {
    const transaction = vi.fn();
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaClient;
    const repository = new WorkflowVersionRepository(prisma);

    await expect(
      repository.create('7778ece0-8fa8-4ce7-9961-c08444ac57fc', {
        schemaVersion: 1,
        workflowId: 'invalid-workflow',
      }),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses to move an existing workflow across workspaces', async () => {
    const definition = await readValidWorkflowFixture();
    const upsert = vi.fn();
    const create = vi.fn();
    const transactionClient = {
      workflow: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ workspaceId: 'existing-workspace' }),
        upsert,
      },
      workflowVersion: { create },
    } as unknown as Prisma.TransactionClient;
    const transaction = vi
      .fn()
      .mockImplementation(
        async (
          operation: (
            client: Prisma.TransactionClient,
          ) => Promise<PersistedVersionResult>,
        ) => operation(transactionClient),
      );
    const repository = new WorkflowVersionRepository({
      $transaction: transaction,
    } as unknown as PrismaClient);

    await expect(
      repository.create('different-workspace', definition),
    ).rejects.toThrow('Workflow belongs to a different workspace');
    expect(upsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

type PersistedVersionResult = Awaited<
  ReturnType<WorkflowVersionRepository['create']>
>;
