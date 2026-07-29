import {
  RecordingArtifactSchema,
  RecordingEventBatchSchema,
  RecordingEventSchema,
  RecordingPrivacySummarySchema,
  RecordingSessionCompleteRequestSchema,
  RecordingSessionCreateRequestSchema,
  type RecordingArtifact,
  type RecordingEventBatch,
  type RecordingSessionCreateRequest,
} from '@tasktwin/recording-schema';

import {
  OrganizationRole,
  Prisma,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { createCanonicalJsonDigest } from './canonical-json.js';
import { RecordingRepositoryError } from './recording-errors.js';
import type {
  CompleteRecordingSessionResult,
  CompletedRecordingArtifactRecord,
  CreateRecordingSessionResult,
  IngestRecordingBatchResult,
  OrganizationAccessRecord,
  RecordingSessionMetadataRecord,
} from './recording-records.js';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const RECORDING_CONVERSION_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;

const recordingSessionMetadataSelect = {
  id: true,
  clientSessionId: true,
  workspaceId: true,
  createdByUserId: true,
  status: true,
  targetOrigin: true,
  startedAt: true,
  stoppedAt: true,
  eventCount: true,
  lastSequence: true,
  receivedEventCount: true,
  receivedMaxSequence: true,
  privacySummary: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const recordingSessionPersistenceSelect = {
  ...recordingSessionMetadataSelect,
  schemaVersion: true,
  metadataDigest: true,
  receivedMinSequence: true,
} as const;

const organizationAccessSelect = {
  organizationId: true,
  userId: true,
  role: true,
} as const;

type SessionMetadataRow = Prisma.RecordingSessionGetPayload<{
  select: typeof recordingSessionMetadataSelect;
}>;

type SessionPersistenceRow = Prisma.RecordingSessionGetPayload<{
  select: typeof recordingSessionPersistenceSelect;
}>;

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function toMetadataRecord(
  row: SessionMetadataRow,
): RecordingSessionMetadataRecord {
  const privacySummary = RecordingPrivacySummarySchema.safeParse(
    row.privacySummary,
  );
  if (!privacySummary.success) {
    throw new RecordingRepositoryError('PERSISTED_RECORDING_INVALID');
  }

  return {
    id: row.id,
    clientSessionId: row.clientSessionId,
    workspaceId: row.workspaceId,
    createdByUserId: row.createdByUserId,
    status: row.status,
    targetOrigin: row.targetOrigin,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    eventCount: row.eventCount,
    lastSequence: row.lastSequence,
    receivedEventCount: row.receivedEventCount,
    receivedLastSequence: row.receivedMaxSequence ?? 0,
    privacySummary: privacySummary.data,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hasMatchingCompletion(
  session: SessionPersistenceRow,
  request: {
    clientSessionId: string;
    eventCount: number;
    lastSequence: number;
    privacySummary: unknown;
  },
): boolean {
  return (
    session.clientSessionId === request.clientSessionId &&
    session.eventCount === request.eventCount &&
    session.lastSequence === request.lastSequence &&
    createCanonicalJsonDigest(session.privacySummary) ===
      createCanonicalJsonDigest(request.privacySummary)
  );
}

export class RecordingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  resolveWorkspaceAccess(
    userId: string,
    workspaceId: string,
  ): Promise<OrganizationAccessRecord | null> {
    return this.prisma.organizationMember.findFirst({
      where: {
        userId,
        organization: {
          workspaces: {
            some: { id: workspaceId },
          },
        },
      },
      select: organizationAccessSelect,
    });
  }

  resolveRecordingSessionAccess(
    userId: string,
    recordingSessionId: string,
  ): Promise<OrganizationAccessRecord | null> {
    return this.prisma.organizationMember.findFirst({
      where: {
        userId,
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
      select: organizationAccessSelect,
    });
  }

  async createSession(
    actorUserId: string,
    workspaceId: string,
    input: unknown,
  ): Promise<CreateRecordingSessionResult> {
    const parsed = RecordingSessionCreateRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new RecordingRepositoryError('INVALID_RECORDING_INPUT');
    }

    const request = parsed.data;
    const metadataDigest = createCanonicalJsonDigest(request);
    const operation = (
      transaction: Prisma.TransactionClient,
    ): Promise<CreateRecordingSessionResult> =>
      this.createSessionInTransaction(
        transaction,
        actorUserId,
        workspaceId,
        request,
        metadataDigest,
      );

    try {
      return await this.runSerializable(operation);
    } catch (error: unknown) {
      if (isPrismaErrorCode(error, 'P2002')) {
        try {
          return await this.runSerializable(operation);
        } catch (retryError: unknown) {
          if (isPrismaErrorCode(retryError, 'P2002')) {
            throw new RecordingRepositoryError('RECORDING_CONFLICT');
          }
          throw retryError;
        }
      }
      throw error;
    }
  }

  async ingestBatch(
    actorUserId: string,
    recordingSessionId: string,
    input: unknown,
  ): Promise<IngestRecordingBatchResult> {
    const parsed = RecordingEventBatchSchema.safeParse(input);
    if (!parsed.success) {
      throw new RecordingRepositoryError('INVALID_RECORDING_INPUT');
    }

    const batch = parsed.data;
    const payloadDigest = createCanonicalJsonDigest(batch);
    const operation = (
      transaction: Prisma.TransactionClient,
    ): Promise<IngestRecordingBatchResult> =>
      this.ingestBatchInTransaction(
        transaction,
        actorUserId,
        recordingSessionId,
        batch,
        payloadDigest,
      );

    try {
      return await this.runSerializable(operation);
    } catch (error: unknown) {
      if (isPrismaErrorCode(error, 'P2002')) {
        try {
          return await this.runSerializable(operation);
        } catch (retryError: unknown) {
          if (isPrismaErrorCode(retryError, 'P2002')) {
            throw new RecordingRepositoryError('BATCH_CONFLICT');
          }
          throw retryError;
        }
      }
      throw error;
    }
  }

  async completeSession(
    actorUserId: string,
    recordingSessionId: string,
    input: unknown,
  ): Promise<CompleteRecordingSessionResult> {
    const parsed = RecordingSessionCompleteRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new RecordingRepositoryError('INVALID_RECORDING_INPUT');
    }

    return this.runSerializable(async (transaction) => {
      const session = await this.findAccessibleSession(
        transaction,
        actorUserId,
        recordingSessionId,
      );
      if (session === null) {
        throw new RecordingRepositoryError('RECORDING_NOT_FOUND');
      }

      if (!hasMatchingCompletion(session, parsed.data)) {
        throw new RecordingRepositoryError('RECORDING_CONFLICT');
      }

      if (session.status === 'completed') {
        return {
          recordingSessionId: session.id,
          clientSessionId: session.clientSessionId,
          status: 'completed',
          eventCount: session.eventCount,
          lastSequence: session.lastSequence,
          idempotent: true,
        };
      }

      const artifact = await this.reconstructValidatedArtifact(
        transaction,
        session,
        'INCOMPLETE_RECORDING',
      );
      const events = artifact.events;

      const completedAt = new Date();
      await transaction.recordingSession.update({
        where: { id: session.id },
        data: {
          status: 'completed',
          completedAt,
          receivedEventCount: events.length,
          receivedMinSequence: events[0]?.sequence ?? null,
          receivedMaxSequence: events.at(-1)?.sequence ?? null,
        },
      });

      return {
        recordingSessionId: session.id,
        clientSessionId: session.clientSessionId,
        status: 'completed',
        eventCount: artifact.eventCount,
        lastSequence: artifact.lastSequence,
        idempotent: false,
      };
    });
  }

  async getCompletedArtifactForConversion(
    actorUserId: string,
    recordingSessionId: string,
  ): Promise<CompletedRecordingArtifactRecord> {
    return this.runSerializable(async (transaction) => {
      const session = await this.findConversionAccessibleSession(
        transaction,
        actorUserId,
        recordingSessionId,
      );
      if (session === null) {
        throw new RecordingRepositoryError('RECORDING_NOT_FOUND');
      }
      if (session.status !== 'completed') {
        throw new RecordingRepositoryError('RECORDING_NOT_COMPLETED');
      }

      return {
        recordingSessionId: session.id,
        workspaceId: session.workspaceId,
        artifact: await this.reconstructValidatedArtifact(
          transaction,
          session,
          'PERSISTED_RECORDING_INVALID',
        ),
      };
    });
  }

  async getSessionMetadata(
    actorUserId: string,
    recordingSessionId: string,
  ): Promise<RecordingSessionMetadataRecord | null> {
    const row = await this.prisma.recordingSession.findFirst({
      where: {
        id: recordingSessionId,
        workspace: {
          organization: {
            members: {
              some: { userId: actorUserId },
            },
          },
        },
      },
      select: recordingSessionMetadataSelect,
    });

    return row === null ? null : toMetadataRecord(row);
  }

  private async createSessionInTransaction(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    workspaceId: string,
    request: RecordingSessionCreateRequest,
    metadataDigest: string,
  ): Promise<CreateRecordingSessionResult> {
    const access = await transaction.organizationMember.findFirst({
      where: {
        userId: actorUserId,
        organization: {
          workspaces: {
            some: { id: workspaceId },
          },
        },
      },
      select: { userId: true },
    });
    if (access === null) {
      throw new RecordingRepositoryError('WORKSPACE_NOT_FOUND');
    }

    const existing = await transaction.recordingSession.findFirst({
      where: {
        clientSessionId: request.clientSessionId,
        workspace: {
          organization: {
            members: {
              some: { userId: actorUserId },
            },
          },
        },
      },
      select: recordingSessionPersistenceSelect,
    });
    if (existing !== null) {
      if (
        existing.workspaceId !== workspaceId ||
        existing.createdByUserId !== actorUserId ||
        existing.metadataDigest !== metadataDigest
      ) {
        throw new RecordingRepositoryError('RECORDING_CONFLICT');
      }

      return { session: toMetadataRecord(existing), idempotent: true };
    }

    const created = await transaction.recordingSession.create({
      data: {
        workspaceId,
        createdByUserId: actorUserId,
        clientSessionId: request.clientSessionId,
        schemaVersion: request.schemaVersion,
        targetOrigin: request.targetOrigin,
        startedAt: new Date(request.startedAt),
        stoppedAt: new Date(request.stoppedAt),
        eventCount: request.eventCount,
        lastSequence: request.lastSequence,
        privacySummary: request.privacySummary as Prisma.InputJsonValue,
        metadataDigest,
      },
      select: recordingSessionMetadataSelect,
    });

    return { session: toMetadataRecord(created), idempotent: false };
  }

  private async ingestBatchInTransaction(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    recordingSessionId: string,
    batch: RecordingEventBatch,
    payloadDigest: string,
  ): Promise<IngestRecordingBatchResult> {
    const session = await this.findAccessibleSession(
      transaction,
      actorUserId,
      recordingSessionId,
    );
    if (session === null) {
      throw new RecordingRepositoryError('RECORDING_NOT_FOUND');
    }

    const existingBatch = await transaction.recordingSyncBatch.findUnique({
      where: {
        recordingSessionId_clientBatchId: {
          recordingSessionId: session.id,
          clientBatchId: batch.clientBatchId,
        },
      },
      select: {
        eventCount: true,
        payloadDigest: true,
      },
    });
    if (existingBatch !== null) {
      if (existingBatch.payloadDigest !== payloadDigest) {
        throw new RecordingRepositoryError('BATCH_CONFLICT');
      }

      return {
        recordingSessionId: session.id,
        clientBatchId: batch.clientBatchId,
        status: session.status,
        acceptedEventCount: existingBatch.eventCount,
        receivedEventCount: session.receivedEventCount,
        receivedLastSequence: session.receivedMaxSequence ?? 0,
        idempotent: true,
      };
    }

    if (session.status === 'completed') {
      throw new RecordingRepositoryError('SESSION_COMPLETED');
    }
    if (
      batch.clientSessionId !== session.clientSessionId ||
      batch.firstSequence < 1 ||
      batch.lastSequence > session.lastSequence ||
      session.eventCount === 0 ||
      batch.events.some((event) => event.origin !== session.targetOrigin)
    ) {
      throw new RecordingRepositoryError('BATCH_CONFLICT');
    }

    const clientEventIds = batch.events.map((event) => event.eventId);
    const sequences = batch.events.map((event) => event.sequence);
    const collision = await transaction.recordingEvent.findFirst({
      where: {
        recordingSessionId: session.id,
        OR: [
          { clientEventId: { in: clientEventIds } },
          { sequence: { in: sequences } },
        ],
      },
      select: { id: true },
    });
    if (collision !== null) {
      throw new RecordingRepositoryError('BATCH_CONFLICT');
    }

    const nextReceivedEventCount =
      session.receivedEventCount + batch.eventCount;
    if (nextReceivedEventCount > session.eventCount) {
      throw new RecordingRepositoryError('BATCH_CONFLICT');
    }

    await transaction.recordingEvent.createMany({
      data: batch.events.map((event) => ({
        recordingSessionId: session.id,
        clientEventId: event.eventId,
        sequence: event.sequence,
        event: event as Prisma.InputJsonValue,
      })),
    });
    await transaction.recordingSyncBatch.create({
      data: {
        recordingSessionId: session.id,
        clientBatchId: batch.clientBatchId,
        firstSequence: batch.firstSequence,
        lastSequence: batch.lastSequence,
        eventCount: batch.eventCount,
        payloadDigest,
      },
    });
    await transaction.recordingSession.update({
      where: { id: session.id },
      data: {
        receivedEventCount: nextReceivedEventCount,
        receivedMinSequence:
          session.receivedMinSequence === null
            ? batch.firstSequence
            : Math.min(session.receivedMinSequence, batch.firstSequence),
        receivedMaxSequence:
          session.receivedMaxSequence === null
            ? batch.lastSequence
            : Math.max(session.receivedMaxSequence, batch.lastSequence),
      },
    });

    return {
      recordingSessionId: session.id,
      clientBatchId: batch.clientBatchId,
      status: session.status,
      acceptedEventCount: batch.eventCount,
      receivedEventCount: nextReceivedEventCount,
      receivedLastSequence: Math.max(
        session.receivedMaxSequence ?? 0,
        batch.lastSequence,
      ),
      idempotent: false,
    };
  }

  private findAccessibleSession(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    recordingSessionId: string,
  ): Promise<SessionPersistenceRow | null> {
    return transaction.recordingSession.findFirst({
      where: {
        id: recordingSessionId,
        workspace: {
          organization: {
            members: {
              some: { userId: actorUserId },
            },
          },
        },
      },
      select: recordingSessionPersistenceSelect,
    });
  }

  private findConversionAccessibleSession(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    recordingSessionId: string,
  ): Promise<SessionPersistenceRow | null> {
    return transaction.recordingSession.findFirst({
      where: {
        id: recordingSessionId,
        workspace: {
          organization: {
            members: {
              some: {
                userId: actorUserId,
                role: { in: [...RECORDING_CONVERSION_ROLES] },
              },
            },
          },
        },
      },
      select: recordingSessionPersistenceSelect,
    });
  }

  private async reconstructValidatedArtifact(
    transaction: Prisma.TransactionClient,
    session: SessionPersistenceRow,
    invalidArtifactErrorCode:
      'INCOMPLETE_RECORDING' | 'PERSISTED_RECORDING_INVALID',
  ): Promise<RecordingArtifact> {
    const storedRows = await transaction.recordingEvent.findMany({
      where: { recordingSessionId: session.id },
      select: {
        clientEventId: true,
        sequence: true,
        event: true,
      },
      orderBy: [{ sequence: 'asc' }, { clientEventId: 'asc' }],
    });

    const events = storedRows.map((row) => {
      const storedEvent = RecordingEventSchema.safeParse(row.event);
      if (
        !storedEvent.success ||
        storedEvent.data.eventId !== row.clientEventId ||
        storedEvent.data.sequence !== row.sequence ||
        storedEvent.data.sessionId !== session.clientSessionId
      ) {
        throw new RecordingRepositoryError('PERSISTED_RECORDING_INVALID');
      }
      return storedEvent.data;
    });

    const artifact = RecordingArtifactSchema.safeParse({
      schemaVersion: session.schemaVersion,
      clientSessionId: session.clientSessionId,
      targetOrigin: session.targetOrigin,
      startedAt: session.startedAt.toISOString(),
      stoppedAt: session.stoppedAt.toISOString(),
      eventCount: session.eventCount,
      lastSequence: session.lastSequence,
      events,
      privacySummary: session.privacySummary,
    });
    if (!artifact.success) {
      throw new RecordingRepositoryError(invalidArtifactErrorCode);
    }

    return artifact.data;
  }

  private async runSerializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (!isPrismaErrorCode(error, 'P2034')) {
          throw error;
        }
        if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
          throw new RecordingRepositoryError('SERIALIZATION_FAILURE');
        }
      }
    }

    throw new RecordingRepositoryError('SERIALIZATION_FAILURE');
  }
}
