import { RecordingArtifactSchema } from '@tasktwin/recording-schema';
import { z } from 'zod';

import {
  MAX_PENDING_RECORDING_OUTBOX_ENTRIES,
  MAX_RETAINED_RECORDING_ARTIFACTS,
} from './constants.js';

const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();

export const RecordingOutboxStatusSchema = z.enum([
  'pending',
  'syncing',
  'synced',
  'failed',
]);

export const RecordingSyncErrorCodeSchema = z.enum([
  'TRANSPORT_UNAVAILABLE',
  'TRANSPORT_REJECTED',
  'INVALID_TRANSPORT_RESPONSE',
]);

export const RecordingOutboxEntrySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    clientSessionId: UuidSchema,
    status: RecordingOutboxStatusSchema,
    attemptCount: z.number().int().nonnegative().max(1_000),
    remoteSessionId: UuidSchema.nullable(),
    lastAttemptAt: TimestampSchema.nullable(),
    lastErrorCode: RecordingSyncErrorCodeSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .superRefine((entry, context) => {
    if (
      entry.status === 'pending' &&
      (entry.attemptCount !== 0 ||
        entry.remoteSessionId !== null ||
        entry.lastAttemptAt !== null ||
        entry.lastErrorCode !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A pending outbox entry must not contain attempt results.',
      });
    }

    if (
      entry.status === 'syncing' &&
      (entry.attemptCount < 1 ||
        entry.remoteSessionId !== null ||
        entry.lastAttemptAt === null ||
        entry.lastErrorCode !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A syncing outbox entry must describe an active attempt.',
      });
    }

    if (
      entry.status === 'synced' &&
      (entry.attemptCount < 1 ||
        entry.remoteSessionId === null ||
        entry.lastAttemptAt === null ||
        entry.lastErrorCode !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A synced outbox entry must contain a safe remote ID.',
      });
    }

    if (
      entry.status === 'failed' &&
      (entry.attemptCount < 1 ||
        entry.remoteSessionId !== null ||
        entry.lastAttemptAt === null ||
        entry.lastErrorCode === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A failed outbox entry must contain a safe error code.',
      });
    }
  });

export const LocalRecordingArchiveSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    artifacts: z
      .array(RecordingArtifactSchema)
      .max(MAX_RETAINED_RECORDING_ARTIFACTS),
    updatedAt: TimestampSchema,
  })
  .superRefine((archive, context) => {
    const artifactIds = new Set<string>();
    archive.artifacts.forEach((artifact, index) => {
      if (artifactIds.has(artifact.clientSessionId)) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', index, 'clientSessionId'],
          message: 'Archived client session IDs must be unique.',
        });
      }
      artifactIds.add(artifact.clientSessionId);
    });
  });

export const LocalRecordingOutboxSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    entries: z
      .array(RecordingOutboxEntrySchema)
      .max(MAX_PENDING_RECORDING_OUTBOX_ENTRIES),
    updatedAt: TimestampSchema,
  })
  .superRefine((outbox, context) => {
    const outboxIds = new Set<string>();
    outbox.entries.forEach((entry, index) => {
      if (outboxIds.has(entry.clientSessionId)) {
        context.addIssue({
          code: 'custom',
          path: ['outbox', index, 'clientSessionId'],
          message: 'Outbox client session IDs must be unique.',
        });
      }
      outboxIds.add(entry.clientSessionId);
    });
  });

export const RecordingTransportSuccessSchema = z.strictObject({
  success: z.literal(true),
  remoteSessionId: UuidSchema,
});

export const RecordingTransportFailureSchema = z.strictObject({
  success: z.literal(false),
  errorCode: RecordingSyncErrorCodeSchema,
});

export const RecordingTransportResultSchema = z.discriminatedUnion('success', [
  RecordingTransportSuccessSchema,
  RecordingTransportFailureSchema,
]);

export type RecordingOutboxStatus = z.infer<typeof RecordingOutboxStatusSchema>;
export type RecordingSyncErrorCode = z.infer<
  typeof RecordingSyncErrorCodeSchema
>;
export type RecordingOutboxEntry = z.infer<typeof RecordingOutboxEntrySchema>;
export type LocalRecordingArchive = z.infer<typeof LocalRecordingArchiveSchema>;
export type LocalRecordingOutbox = z.infer<typeof LocalRecordingOutboxSchema>;
export type RecordingTransportResult = z.infer<
  typeof RecordingTransportResultSchema
>;
