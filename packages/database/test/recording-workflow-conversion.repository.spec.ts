import { readFile } from 'node:fs/promises';

import {
  convertRecordingArtifact,
  type RecordingConversionOptions,
  type WorkflowDraftConversion,
} from '@tasktwin/recording-converter';
import {
  RecordingArtifactSchema,
  type RecordingArtifact,
} from '@tasktwin/recording-schema';
import { describe, expect, it, vi } from 'vitest';

import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { RecordingWorkflowConversionRepositoryError } from '../src/recording-conversion/recording-workflow-conversion-errors.js';
import { RecordingWorkflowConversionRepository } from '../src/recording-conversion/recording-workflow-conversion.repository.js';

const actorUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const recordingSessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const clientConversionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const conversionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const workflowVersionId = '99999999-9999-4999-8999-999999999999';
const createdAt = new Date('2026-07-29T20:00:00.000Z');
const options: RecordingConversionOptions = {
  schemaVersion: 1,
  workflowId: '77777777-7777-4777-8777-777777777777',
  workflowName: 'Recorded customer setup',
  description: 'Draft converted from a completed recording.',
};

async function readValidArtifact(): Promise<RecordingArtifact> {
  const fixtureUrl = new URL(
    '../../recording-schema/fixtures/valid-recording-artifact.v1.json',
    import.meta.url,
  );
  return RecordingArtifactSchema.parse(
    JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown,
  );
}

async function createDraftResult(): Promise<WorkflowDraftConversion> {
  const result = convertRecordingArtifact(await readValidArtifact(), options);
  if (result.outcome !== 'draft') {
    throw new Error('Expected the recording fixture to produce a draft');
  }
  return result;
}

function conversionRow(result: WorkflowDraftConversion) {
  return {
    id: conversionId,
    recordingSessionId,
    clientConversionId,
    workflowId: result.workflowDefinition.workflowId,
    workflowVersionId,
    createdById: actorUserId,
    conversionReport: result.report,
    createdAt,
    workflowVersion: {
      id: workflowVersionId,
      workflowId: result.workflowDefinition.workflowId,
      version: 1,
      status: 'draft',
      schemaVersion: result.workflowDefinition.schemaVersion,
      definition: result.workflowDefinition,
    },
    workflow: {
      workspaceId,
    },
    recordingSession: {
      clientSessionId: result.report.sourceClientSessionId,
      eventCount: result.report.sourceEventCount,
      status: 'completed',
      workspaceId,
    },
  };
}

function createTransactionClient(
  result: WorkflowDraftConversion,
  overrides: Partial<{
    recordingSession: object;
    recordingWorkflowConversion: object;
    workflow: object;
    workflowVersion: object;
  }> = {},
): Prisma.TransactionClient {
  return {
    recordingSession: {
      findFirst: vi.fn().mockResolvedValue({
        id: recordingSessionId,
        workspaceId,
        clientSessionId: result.report.sourceClientSessionId,
        eventCount: result.report.sourceEventCount,
        status: 'completed',
      }),
    },
    recordingWorkflowConversion: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(conversionRow(result)),
    },
    workflow: {
      create: vi.fn().mockResolvedValue(undefined),
    },
    workflowVersion: {
      create: vi.fn().mockResolvedValue({ id: workflowVersionId }),
    },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

function createRepository(transactionClient: Prisma.TransactionClient): {
  repository: RecordingWorkflowConversionRepository;
  transaction: ReturnType<typeof vi.fn>;
} {
  const transaction = vi
    .fn()
    .mockImplementation(
      async (
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(transactionClient),
    );

  return {
    repository: new RecordingWorkflowConversionRepository({
      $transaction: transaction,
    } as unknown as PrismaClient),
    transaction,
  };
}

async function expectRepositoryErrorCode(
  operation: Promise<unknown>,
  code: RecordingWorkflowConversionRepositoryError['code'],
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(RecordingWorkflowConversionRepositoryError);
    expect((error as RecordingWorkflowConversionRepositoryError).code).toBe(
      code,
    );
  }
}

describe('RecordingWorkflowConversionRepository', () => {
  it('rejects invalid or non-draft conversion output before a transaction', async () => {
    const transaction = vi.fn();
    const repository = new RecordingWorkflowConversionRepository({
      $transaction: transaction,
    } as unknown as PrismaClient);

    await expectRepositoryErrorCode(
      repository.createDraft(
        actorUserId,
        recordingSessionId,
        clientConversionId,
        options,
        {
          schemaVersion: 1,
          outcome: 'no-executable-steps',
          workflowDefinition: null,
          report: {},
        },
      ),
      'INVALID_CONVERSION_INPUT',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('creates the workflow, draft version, and receipt in one transaction', async () => {
    const result = await createDraftResult();
    const transactionClient = createTransactionClient(result);
    const { repository, transaction } = createRepository(transactionClient);

    const persisted = await repository.createDraft(
      actorUserId,
      recordingSessionId,
      clientConversionId,
      options,
      result,
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(persisted.idempotent).toBe(false);
    expect(persisted.conversion).toMatchObject({
      recordingSessionId,
      clientConversionId,
      workflowId: options.workflowId,
      workflowVersionId,
      createdById: actorUserId,
    });
    expect(transactionClient.recordingSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: recordingSessionId,
          workspace: {
            organization: {
              members: {
                some: {
                  userId: actorUserId,
                  role: { in: ['OWNER', 'ADMIN', 'MEMBER'] },
                },
              },
            },
          },
        }),
      }),
    );
    expect(transactionClient.workflow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: options.workflowId,
        workspaceId,
      }),
    });
    expect(transactionClient.workflowVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: options.workflowId,
        version: 1,
        status: 'draft',
      }),
      select: { id: true },
    });
    expect(
      transactionClient.recordingWorkflowConversion.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordingSessionId,
          clientConversionId,
          workflowId: options.workflowId,
          workflowVersionId,
          createdById: actorUserId,
        }),
      }),
    );
  });

  it('returns an existing receipt idempotently without creating another draft', async () => {
    const result = await createDraftResult();
    const existing = conversionRow(result);
    const transactionClient = createTransactionClient(result, {
      recordingWorkflowConversion: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);

    const persisted = await repository.createDraft(
      actorUserId,
      recordingSessionId,
      clientConversionId,
      options,
      result,
    );

    expect(persisted.idempotent).toBe(true);
    expect(persisted.conversion.id).toBe(conversionId);
    expect(transactionClient.workflow.create).not.toHaveBeenCalled();
    expect(transactionClient.workflowVersion.create).not.toHaveBeenCalled();
    expect(
      transactionClient.recordingWorkflowConversion.create,
    ).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with different options', async () => {
    const result = await createDraftResult();
    const existing = conversionRow(result);
    const transactionClient = createTransactionClient(result, {
      recordingWorkflowConversion: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);
    const conflictingOptions = {
      ...options,
      workflowId: '66666666-6666-4666-8666-666666666666',
      workflowName: 'A different requested name',
    };
    const conflictingResult = convertRecordingArtifact(
      await readValidArtifact(),
      conflictingOptions,
    );

    await expectRepositoryErrorCode(
      repository.createDraft(
        actorUserId,
        recordingSessionId,
        clientConversionId,
        conflictingOptions,
        conflictingResult,
      ),
      'CONVERSION_CONFLICT',
    );
    expect(transactionClient.workflow.create).not.toHaveBeenCalled();
  });

  it('rejects a recording that is not completed before any write', async () => {
    const result = await createDraftResult();
    const transactionClient = createTransactionClient(result, {
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: recordingSessionId,
          workspaceId,
          clientSessionId: result.report.sourceClientSessionId,
          eventCount: result.report.sourceEventCount,
          status: 'receiving',
        }),
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.createDraft(
        actorUserId,
        recordingSessionId,
        clientConversionId,
        options,
        result,
      ),
      'RECORDING_NOT_COMPLETED',
    );
    expect(transactionClient.workflow.create).not.toHaveBeenCalled();
  });

  it('rejects a conversion result that belongs to another recording', async () => {
    const result = await createDraftResult();
    const transactionClient = createTransactionClient(result, {
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: recordingSessionId,
          workspaceId,
          clientSessionId: '12121212-1212-4121-8121-121212121212',
          eventCount: result.report.sourceEventCount,
          status: 'completed',
        }),
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.createDraft(
        actorUserId,
        recordingSessionId,
        clientConversionId,
        options,
        result,
      ),
      'INVALID_CONVERSION_INPUT',
    );
    expect(transactionClient.workflow.create).not.toHaveBeenCalled();
  });

  it('keeps all persistence writes in the transaction when receipt creation fails', async () => {
    const result = await createDraftResult();
    const receiptFailure = new Error('simulated receipt failure');
    const transactionClient = createTransactionClient(result, {
      recordingWorkflowConversion: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(receiptFailure),
      },
    });
    const { repository, transaction } = createRepository(transactionClient);

    await expect(
      repository.createDraft(
        actorUserId,
        recordingSessionId,
        clientConversionId,
        options,
        result,
      ),
    ).rejects.toBe(receiptFailure);
    expect(transaction).toHaveBeenCalledOnce();
    expect(transactionClient.workflow.create).toHaveBeenCalledOnce();
    expect(transactionClient.workflowVersion.create).toHaveBeenCalledOnce();
    expect(
      transactionClient.recordingWorkflowConversion.create,
    ).toHaveBeenCalledOnce();
  });

  it('recovers a unique-key race by reading the committed receipt', async () => {
    const result = await createDraftResult();
    const existing = conversionRow(result);
    const transaction = vi.fn().mockRejectedValue({ code: 'P2002' });
    const findFirst = vi.fn().mockResolvedValue(existing);
    const repository = new RecordingWorkflowConversionRepository({
      $transaction: transaction,
      recordingWorkflowConversion: { findFirst },
    } as unknown as PrismaClient);

    const persisted = await repository.createDraft(
      actorUserId,
      recordingSessionId,
      clientConversionId,
      options,
      result,
    );

    expect(persisted.idempotent).toBe(true);
    expect(persisted.conversion.id).toBe(conversionId);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordingSessionId,
          clientConversionId,
        }),
      }),
    );
  });

  it('maps an unrelated unique-key collision to a conversion conflict', async () => {
    const result = await createDraftResult();
    const repository = new RecordingWorkflowConversionRepository({
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
      recordingWorkflowConversion: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient);

    await expectRepositoryErrorCode(
      repository.createDraft(
        actorUserId,
        recordingSessionId,
        clientConversionId,
        options,
        result,
      ),
      'CONVERSION_CONFLICT',
    );
  });

  it('retries serialization conflicts only within the fixed bound', async () => {
    const result = await createDraftResult();
    const transaction = vi.fn().mockRejectedValue({ code: 'P2034' });
    const repository = new RecordingWorkflowConversionRepository({
      $transaction: transaction,
    } as unknown as PrismaClient);

    await expectRepositoryErrorCode(
      repository.createDraft(
        actorUserId,
        recordingSessionId,
        clientConversionId,
        options,
        result,
      ),
      'SERIALIZATION_FAILURE',
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
