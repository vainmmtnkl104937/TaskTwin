import { readFile } from 'node:fs/promises';

import {
  createRecordingPrivacySummary,
  RecordingArtifactSchema,
  type RecordingArtifact,
  type RecordingEventBatch,
  type RecordingSessionCompleteRequest,
  type RecordingSessionCreateRequest,
} from '@tasktwin/recording-schema';
import { describe, expect, it, vi } from 'vitest';

import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { createCanonicalJsonDigest } from '../src/recording/canonical-json.js';
import { RecordingRepositoryError } from '../src/recording/recording-errors.js';
import { RecordingRepository } from '../src/recording/recording.repository.js';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const organizationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const recordingSessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const createdAt = new Date('2026-07-29T11:00:00.000Z');
const updatedAt = new Date('2026-07-29T11:00:00.000Z');

async function readValidArtifact(): Promise<RecordingArtifact> {
  const fixtureUrl = new URL(
    '../../recording-schema/fixtures/valid-recording-artifact.v1.json',
    import.meta.url,
  );
  return RecordingArtifactSchema.parse(
    JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown,
  );
}

function toCreateRequest(
  artifact: RecordingArtifact,
): RecordingSessionCreateRequest {
  return {
    schemaVersion: 1,
    clientSessionId: artifact.clientSessionId,
    targetOrigin: artifact.targetOrigin,
    startedAt: artifact.startedAt,
    stoppedAt: artifact.stoppedAt,
    eventCount: artifact.eventCount,
    lastSequence: artifact.lastSequence,
    privacySummary: artifact.privacySummary,
  };
}

function toBatch(artifact: RecordingArtifact): RecordingEventBatch {
  return {
    schemaVersion: 1,
    clientSessionId: artifact.clientSessionId,
    clientBatchId: 'fixture-batch-001',
    eventCount: artifact.eventCount,
    firstSequence: 1,
    lastSequence: artifact.lastSequence,
    events: artifact.events,
  };
}

function toCompleteRequest(
  artifact: RecordingArtifact,
): RecordingSessionCompleteRequest {
  return {
    schemaVersion: 1,
    clientSessionId: artifact.clientSessionId,
    eventCount: artifact.eventCount,
    lastSequence: artifact.lastSequence,
    privacySummary: artifact.privacySummary,
  };
}

function sessionRow(
  artifact: RecordingArtifact,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: recordingSessionId,
    workspaceId,
    createdByUserId: actorUserId,
    clientSessionId: artifact.clientSessionId,
    schemaVersion: artifact.schemaVersion,
    targetOrigin: artifact.targetOrigin,
    startedAt: new Date(artifact.startedAt),
    stoppedAt: new Date(artifact.stoppedAt),
    eventCount: artifact.eventCount,
    lastSequence: artifact.lastSequence,
    privacySummary: artifact.privacySummary,
    metadataDigest: createCanonicalJsonDigest(toCreateRequest(artifact)),
    status: 'receiving',
    receivedEventCount: 0,
    receivedMinSequence: null,
    receivedMaxSequence: null,
    completedAt: null,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function createTransactionClient(
  overrides: Partial<{
    organizationMember: object;
    recordingSession: object;
    recordingEvent: object;
    recordingSyncBatch: object;
  }> = {},
): Prisma.TransactionClient {
  return {
    organizationMember: {
      findFirst: vi.fn().mockResolvedValue({
        organizationId,
        userId: actorUserId,
        role: 'OWNER',
      }),
    },
    recordingSession: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    recordingEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    recordingSyncBatch: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

function createRepository(transactionClient: Prisma.TransactionClient): {
  repository: RecordingRepository;
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
    repository: new RecordingRepository({
      $transaction: transaction,
    } as unknown as PrismaClient),
    transaction,
  };
}

async function expectRepositoryErrorCode(
  operation: Promise<unknown>,
  code: RecordingRepositoryError['code'],
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(RecordingRepositoryError);
    expect((error as RecordingRepositoryError).code).toBe(code);
  }
}

describe('RecordingRepository', () => {
  it('resolves workspace and recording access through organization membership', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      organizationId,
      userId: actorUserId,
      role: 'OWNER',
    });
    const repository = new RecordingRepository({
      organizationMember: { findFirst },
    } as unknown as PrismaClient);

    await repository.resolveWorkspaceAccess(actorUserId, workspaceId);
    expect(findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: actorUserId,
          organization: {
            workspaces: {
              some: { id: workspaceId },
            },
          },
        },
      }),
    );

    await repository.resolveRecordingSessionAccess(
      actorUserId,
      recordingSessionId,
    );
    expect(findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: actorUserId,
          organization: {
            workspaces: {
              some: {
                recordingSessions: {
                  some: { id: recordingSessionId },
                },
              },
            },
          },
        },
      }),
    );
  });

  it('rejects invalid session input before opening a transaction', async () => {
    const transaction = vi.fn();
    const repository = new RecordingRepository({
      $transaction: transaction,
    } as unknown as PrismaClient);

    await expectRepositoryErrorCode(
      repository.createSession(actorUserId, workspaceId, {
        schemaVersion: 1,
      }),
      'INVALID_RECORDING_INPUT',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('creates a membership-scoped receiving session with safe metadata', async () => {
    const artifact = await readValidArtifact();
    const created = sessionRow(artifact);
    const create = vi.fn().mockResolvedValue(created);
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
        update: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);

    const result = await repository.createSession(
      actorUserId,
      workspaceId,
      toCreateRequest(artifact),
    );

    expect(result.idempotent).toBe(false);
    expect(result.session).toMatchObject({
      id: recordingSessionId,
      workspaceId,
      clientSessionId: artifact.clientSessionId,
      status: 'receiving',
      receivedEventCount: 0,
      receivedLastSequence: 0,
    });
    expect(result.session).not.toHaveProperty('events');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId,
          createdByUserId: actorUserId,
          clientSessionId: artifact.clientSessionId,
        }),
      }),
    );
  });

  it('returns the existing session for an exact client-session retry', async () => {
    const artifact = await readValidArtifact();
    const existing = sessionRow(artifact);
    const create = vi.fn();
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create,
        update: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);

    const result = await repository.createSession(
      actorUserId,
      workspaceId,
      toCreateRequest(artifact),
    );

    expect(result.idempotent).toBe(true);
    expect(result.session.id).toBe(recordingSessionId);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a different declaration for the same client session', async () => {
    const artifact = await readValidArtifact();
    const conflicting = sessionRow(artifact, {
      metadataDigest: '0'.repeat(64),
    });
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(conflicting),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.createSession(
        actorUserId,
        workspaceId,
        toCreateRequest(artifact),
      ),
      'RECORDING_CONFLICT',
    );
  });

  it('persists a valid batch and its idempotency record atomically', async () => {
    const artifact = await readValidArtifact();
    const batch = toBatch(artifact);
    const createMany = vi.fn().mockResolvedValue({ count: batch.eventCount });
    const createBatch = vi.fn().mockResolvedValue(undefined);
    const updateSession = vi.fn().mockResolvedValue(undefined);
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(sessionRow(artifact)),
        update: updateSession,
      },
      recordingEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn(),
        createMany,
      },
      recordingSyncBatch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: createBatch,
      },
    });
    const { repository, transaction } = createRepository(transactionClient);

    const result = await repository.ingestBatch(
      actorUserId,
      recordingSessionId,
      batch,
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(result).toEqual({
      recordingSessionId,
      clientBatchId: batch.clientBatchId,
      status: 'receiving',
      acceptedEventCount: batch.eventCount,
      receivedEventCount: batch.eventCount,
      receivedLastSequence: batch.lastSequence,
      idempotent: false,
    });
    expect(createMany).toHaveBeenCalledOnce();
    expect(createBatch).toHaveBeenCalledOnce();
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          receivedEventCount: batch.eventCount,
          receivedMinSequence: 1,
          receivedMaxSequence: batch.lastSequence,
        }),
      }),
    );
  });

  it('returns an exact batch retry without inserting events again', async () => {
    const artifact = await readValidArtifact();
    const batch = toBatch(artifact);
    const createMany = vi.fn();
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(
          sessionRow(artifact, {
            status: 'completed',
            receivedEventCount: artifact.eventCount,
            receivedMinSequence: 1,
            receivedMaxSequence: artifact.lastSequence,
          }),
        ),
        update: vi.fn(),
      },
      recordingEvent: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        createMany,
      },
      recordingSyncBatch: {
        findUnique: vi.fn().mockResolvedValue({
          eventCount: batch.eventCount,
          payloadDigest: createCanonicalJsonDigest(batch),
        }),
        create: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);

    const result = await repository.ingestBatch(
      actorUserId,
      recordingSessionId,
      batch,
    );

    expect(result.idempotent).toBe(true);
    expect(result.status).toBe('completed');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('rejects a new batch after the session is completed', async () => {
    const artifact = await readValidArtifact();
    const batch = toBatch(artifact);
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(
          sessionRow(artifact, {
            status: 'completed',
            completedAt: updatedAt,
          }),
        ),
        update: vi.fn(),
      },
      recordingSyncBatch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.ingestBatch(actorUserId, recordingSessionId, batch),
      'SESSION_COMPLETED',
    );
  });

  it('rejects a reused batch ID with a different digest', async () => {
    const artifact = await readValidArtifact();
    const batch = toBatch(artifact);
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(sessionRow(artifact)),
        update: vi.fn(),
      },
      recordingSyncBatch: {
        findUnique: vi.fn().mockResolvedValue({
          eventCount: batch.eventCount,
          payloadDigest: '0'.repeat(64),
        }),
        create: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.ingestBatch(actorUserId, recordingSessionId, batch),
      'BATCH_CONFLICT',
    );
  });

  it('rejects sequence or event-ID overlap under a new batch ID', async () => {
    const artifact = await readValidArtifact();
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(sessionRow(artifact)),
        update: vi.fn(),
      },
      recordingEvent: {
        findFirst: vi.fn().mockResolvedValue({ id: 'stored-event' }),
        findMany: vi.fn(),
        createMany: vi.fn(),
      },
      recordingSyncBatch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.ingestBatch(
        actorUserId,
        recordingSessionId,
        toBatch(artifact),
      ),
      'BATCH_CONFLICT',
    );
  });

  it('rejects a sensitive malformed batch before opening a transaction', async () => {
    const artifact = await readValidArtifact();
    const batch = toBatch(artifact);
    const blockedEvent = batch.events[2];
    if (blockedEvent === undefined) {
      throw new Error('Expected the blocked fixture event');
    }
    const transaction = vi.fn();
    const repository = new RecordingRepository({
      $transaction: transaction,
    } as unknown as PrismaClient);

    await expectRepositoryErrorCode(
      repository.ingestBatch(actorUserId, recordingSessionId, {
        ...batch,
        events: [
          ...batch.events.slice(0, 2),
          {
            ...blockedEvent,
            payload: {
              capturePolicy: 'block',
              value: 'must-not-be-persisted',
            },
          },
        ],
      }),
      'INVALID_RECORDING_INPUT',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects forged general privacy for password metadata before opening a transaction', async () => {
    const artifact = await readValidArtifact();
    const batch = toBatch(artifact);
    const passwordEvent = batch.events[2];
    if (
      passwordEvent === undefined ||
      passwordEvent.eventType !== 'text-input'
    ) {
      throw new Error('Expected the password fixture event');
    }
    const transaction = vi.fn();
    const repository = new RecordingRepository({
      $transaction: transaction,
    } as unknown as PrismaClient);

    await expectRepositoryErrorCode(
      repository.ingestBatch(actorUserId, recordingSessionId, {
        ...batch,
        events: [
          ...batch.events.slice(0, 2),
          {
            ...passwordEvent,
            privacyDecision: {
              schemaVersion: 1,
              sensitivity: 'general',
              policy: 'allow',
              confidence: 'medium',
              matchedRules: ['GENERAL_NO_SENSITIVE_SIGNAL'],
              reasons: ['No supported sensitive metadata rule matched.'],
            },
            payload: {
              capturePolicy: 'allow',
              value: 'arbitrary credential text',
              truncated: false,
            },
          },
        ],
      }),
      'INVALID_RECORDING_INPUT',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rebuilds and validates the complete artifact before completion', async () => {
    const artifact = await readValidArtifact();
    const update = vi.fn().mockResolvedValue(undefined);
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(
          sessionRow(artifact, {
            receivedEventCount: artifact.eventCount,
            receivedMinSequence: 1,
            receivedMaxSequence: artifact.lastSequence,
          }),
        ),
        update,
      },
      recordingEvent: {
        findFirst: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue(
          artifact.events.map((event) => ({
            clientEventId: event.eventId,
            sequence: event.sequence,
            event,
          })),
        ),
      },
    });
    const { repository } = createRepository(transactionClient);

    const result = await repository.completeSession(
      actorUserId,
      recordingSessionId,
      toCompleteRequest(artifact),
    );

    expect(result).toEqual({
      recordingSessionId,
      clientSessionId: artifact.clientSessionId,
      status: 'completed',
      eventCount: artifact.eventCount,
      lastSequence: artifact.lastSequence,
      idempotent: false,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          receivedEventCount: artifact.eventCount,
        }),
      }),
    );
  });

  it('returns an idempotent completion without rewriting the session', async () => {
    const artifact = await readValidArtifact();
    const update = vi.fn();
    const findMany = vi.fn();
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(
          sessionRow(artifact, {
            status: 'completed',
            completedAt: updatedAt,
            receivedEventCount: artifact.eventCount,
            receivedMinSequence: 1,
            receivedMaxSequence: artifact.lastSequence,
          }),
        ),
        update,
      },
      recordingEvent: {
        findFirst: vi.fn(),
        createMany: vi.fn(),
        findMany,
      },
    });
    const { repository } = createRepository(transactionClient);

    const result = await repository.completeSession(
      actorUserId,
      recordingSessionId,
      toCompleteRequest(artifact),
    );

    expect(result.idempotent).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('reconstructs a completed artifact for an authorized conversion', async () => {
    const artifact = await readValidArtifact();
    const findMany = vi.fn().mockResolvedValue(
      artifact.events.map((event) => ({
        clientEventId: event.eventId,
        sequence: event.sequence,
        event,
      })),
    );
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(
          sessionRow(artifact, {
            status: 'completed',
            completedAt: updatedAt,
            receivedEventCount: artifact.eventCount,
            receivedMinSequence: 1,
            receivedMaxSequence: artifact.lastSequence,
          }),
        ),
        update: vi.fn(),
      },
      recordingEvent: {
        findFirst: vi.fn(),
        createMany: vi.fn(),
        findMany,
      },
    });
    const { repository } = createRepository(transactionClient);

    const result = await repository.getCompletedArtifactForConversion(
      actorUserId,
      recordingSessionId,
    );

    expect(result).toEqual({
      recordingSessionId,
      workspaceId,
      artifact,
    });
    expect(transactionClient.recordingSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
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
    expect(findMany).toHaveBeenCalledOnce();
  });

  it('rejects conversion before loading events when recording is not completed', async () => {
    const artifact = await readValidArtifact();
    const findMany = vi.fn();
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(sessionRow(artifact)),
        update: vi.fn(),
      },
      recordingEvent: {
        findFirst: vi.fn(),
        createMany: vi.fn(),
        findMany,
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.getCompletedArtifactForConversion(
        actorUserId,
        recordingSessionId,
      ),
      'RECORDING_NOT_COMPLETED',
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid persisted event data when reconstructing for conversion', async () => {
    const artifact = await readValidArtifact();
    const firstEvent = artifact.events[0];
    if (firstEvent === undefined) {
      throw new Error('Expected a recording event fixture');
    }
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(
          sessionRow(artifact, {
            status: 'completed',
            completedAt: updatedAt,
          }),
        ),
        update: vi.fn(),
      },
      recordingEvent: {
        findFirst: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          {
            clientEventId: firstEvent.eventId,
            sequence: firstEvent.sequence,
            event: {
              ...firstEvent,
              sessionId: '12121212-1212-4121-8121-121212121212',
            },
          },
        ]),
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.getCompletedArtifactForConversion(
        actorUserId,
        recordingSessionId,
      ),
      'PERSISTED_RECORDING_INVALID',
    );
  });

  it('supports completing an empty 0/0 artifact', async () => {
    const source = await readValidArtifact();
    const emptyArtifact = RecordingArtifactSchema.parse({
      ...source,
      eventCount: 0,
      lastSequence: 0,
      events: [],
      privacySummary: createRecordingPrivacySummary([]),
    });
    const update = vi.fn().mockResolvedValue(undefined);
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(sessionRow(emptyArtifact)),
        update,
      },
      recordingEvent: {
        findFirst: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    const { repository } = createRepository(transactionClient);

    const result = await repository.completeSession(
      actorUserId,
      recordingSessionId,
      toCompleteRequest(emptyArtifact),
    );

    expect(result).toMatchObject({
      status: 'completed',
      eventCount: 0,
      lastSequence: 0,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          receivedMinSequence: null,
          receivedMaxSequence: null,
        }),
      }),
    );
  });

  it('rejects completion when the stored sequence has a gap', async () => {
    const artifact = await readValidArtifact();
    const eventsWithGap = [artifact.events[0], artifact.events[2]];
    const transactionClient = createTransactionClient({
      recordingSession: {
        findFirst: vi.fn().mockResolvedValue(sessionRow(artifact)),
        update: vi.fn(),
      },
      recordingEvent: {
        findFirst: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue(
          eventsWithGap.map((event) => ({
            clientEventId: event?.eventId,
            sequence: event?.sequence,
            event,
          })),
        ),
      },
    });
    const { repository } = createRepository(transactionClient);

    await expectRepositoryErrorCode(
      repository.completeSession(
        actorUserId,
        recordingSessionId,
        toCompleteRequest(artifact),
      ),
      'INCOMPLETE_RECORDING',
    );
  });

  it('does not expose raw events from the metadata query', async () => {
    const artifact = await readValidArtifact();
    const findFirst = vi.fn().mockResolvedValue(sessionRow(artifact));
    const repository = new RecordingRepository({
      recordingSession: { findFirst },
    } as unknown as PrismaClient);

    const result = await repository.getSessionMetadata(
      actorUserId,
      recordingSessionId,
    );

    expect(result).not.toHaveProperty('events');
    expect(result).not.toHaveProperty('event');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace: {
            organization: {
              members: {
                some: { userId: actorUserId },
              },
            },
          },
        }),
      }),
    );
  });

  it('retries serialization conflicts only within the fixed bound', async () => {
    const artifact = await readValidArtifact();
    const transaction = vi.fn().mockRejectedValue({ code: 'P2034' });
    const repository = new RecordingRepository({
      $transaction: transaction,
    } as unknown as PrismaClient);

    await expectRepositoryErrorCode(
      repository.createSession(
        actorUserId,
        workspaceId,
        toCreateRequest(artifact),
      ),
      'SERIALIZATION_FAILURE',
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});

describe('createCanonicalJsonDigest', () => {
  it('is independent from object property insertion order', () => {
    expect(createCanonicalJsonDigest({ beta: 2, alpha: 1 })).toBe(
      createCanonicalJsonDigest({ alpha: 1, beta: 2 }),
    );
  });
});
