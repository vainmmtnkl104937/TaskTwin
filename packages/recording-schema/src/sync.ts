import { z } from 'zod';

import {
  MAX_RECORDING_BATCH_EVENTS,
  MAX_RECORDING_EVENTS,
} from './constants.js';
import { RecordingEventSchema } from './events.js';
import {
  ClientBatchIdSchema,
  OriginSchema,
  RecordingEventCountSchema,
  RecordingLastSequenceSchema,
  RecordingSequenceSchema,
  TimestampSchema,
  UuidSchema,
} from './primitives.js';
import { RecordingPrivacySummarySchema } from './privacy-summary.js';

function validateDeclaredRecordingMetadata(
  value: {
    startedAt?: string;
    stoppedAt?: string;
    eventCount: number;
    lastSequence: number;
    privacySummary: { totalEvents: number };
  },
  context: z.RefinementCtx,
): void {
  if (
    value.startedAt !== undefined &&
    value.stoppedAt !== undefined &&
    Date.parse(value.stoppedAt) < Date.parse(value.startedAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['stoppedAt'],
      message: 'Stopped time must not precede started time.',
    });
  }
  if (value.lastSequence !== value.eventCount) {
    context.addIssue({
      code: 'custom',
      path: ['lastSequence'],
      message: 'Last sequence must equal the contiguous event count.',
    });
  }
  if (value.privacySummary.totalEvents !== value.eventCount) {
    context.addIssue({
      code: 'custom',
      path: ['privacySummary', 'totalEvents'],
      message: 'Privacy summary total must match the declared event count.',
    });
  }
}

export const RecordingSessionCreateRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    clientSessionId: UuidSchema,
    targetOrigin: OriginSchema,
    startedAt: TimestampSchema,
    stoppedAt: TimestampSchema,
    eventCount: RecordingEventCountSchema,
    lastSequence: RecordingLastSequenceSchema,
    privacySummary: RecordingPrivacySummarySchema,
  })
  .superRefine(validateDeclaredRecordingMetadata);

export const RecordingEventBatchSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    clientSessionId: UuidSchema,
    clientBatchId: ClientBatchIdSchema,
    eventCount: z.number().int().positive().max(MAX_RECORDING_BATCH_EVENTS),
    firstSequence: RecordingSequenceSchema.max(MAX_RECORDING_EVENTS),
    lastSequence: RecordingSequenceSchema.max(MAX_RECORDING_EVENTS),
    events: z
      .array(RecordingEventSchema)
      .min(1)
      .max(MAX_RECORDING_BATCH_EVENTS),
  })
  .superRefine((batch, context) => {
    if (batch.eventCount !== batch.events.length) {
      context.addIssue({
        code: 'custom',
        path: ['eventCount'],
        message: 'Batch event count must match the events array.',
      });
    }

    const firstEvent = batch.events[0];
    const lastEvent = batch.events.at(-1);
    if (
      firstEvent !== undefined &&
      firstEvent.sequence !== batch.firstSequence
    ) {
      context.addIssue({
        code: 'custom',
        path: ['firstSequence'],
        message: 'First sequence must match the first batch event.',
      });
    }
    if (lastEvent !== undefined && lastEvent.sequence !== batch.lastSequence) {
      context.addIssue({
        code: 'custom',
        path: ['lastSequence'],
        message: 'Last sequence must match the final batch event.',
      });
    }

    const eventIds = new Set<string>();
    batch.events.forEach((event, index) => {
      if (event.sequence !== batch.firstSequence + index) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sequence'],
          message: 'Batch events must be contiguous and ordered.',
        });
      }
      if (event.sessionId !== batch.clientSessionId) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sessionId'],
          message: 'Batch event session must match the client session.',
        });
      }
      if (eventIds.has(event.eventId)) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'eventId'],
          message: 'Batch event IDs must be unique.',
        });
      }
      eventIds.add(event.eventId);
    });
  });

export const RecordingSessionCompleteRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    clientSessionId: UuidSchema,
    eventCount: RecordingEventCountSchema,
    lastSequence: RecordingLastSequenceSchema,
    privacySummary: RecordingPrivacySummarySchema,
  })
  .superRefine(validateDeclaredRecordingMetadata);

export const RecordingSessionStatusSchema = z.enum(['receiving', 'completed']);

export const RecordingSessionCreateResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recordingSessionId: UuidSchema,
  clientSessionId: UuidSchema,
  status: RecordingSessionStatusSchema,
  idempotent: z.boolean(),
});

export const RecordingEventBatchResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recordingSessionId: UuidSchema,
  clientBatchId: ClientBatchIdSchema,
  status: RecordingSessionStatusSchema,
  acceptedEventCount: z.number().int().min(0).max(MAX_RECORDING_BATCH_EVENTS),
  receivedEventCount: RecordingEventCountSchema,
  receivedLastSequence: RecordingLastSequenceSchema,
  idempotent: z.boolean(),
});

export const RecordingSessionCompleteResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recordingSessionId: UuidSchema,
  clientSessionId: UuidSchema,
  status: z.literal('completed'),
  eventCount: RecordingEventCountSchema,
  lastSequence: RecordingLastSequenceSchema,
  idempotent: z.boolean(),
});

export const RecordingSessionMetadataResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recordingSessionId: UuidSchema,
  clientSessionId: UuidSchema,
  workspaceId: UuidSchema,
  createdByUserId: UuidSchema,
  status: RecordingSessionStatusSchema,
  targetOrigin: OriginSchema,
  startedAt: TimestampSchema,
  stoppedAt: TimestampSchema,
  eventCount: RecordingEventCountSchema,
  lastSequence: RecordingLastSequenceSchema,
  receivedEventCount: RecordingEventCountSchema,
  receivedLastSequence: RecordingLastSequenceSchema,
  privacySummary: RecordingPrivacySummarySchema,
  completedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type RecordingSessionCreateRequest = z.infer<
  typeof RecordingSessionCreateRequestSchema
>;
export type RecordingEventBatch = z.infer<typeof RecordingEventBatchSchema>;
export type RecordingSessionCompleteRequest = z.infer<
  typeof RecordingSessionCompleteRequestSchema
>;
export type RecordingSessionStatus = z.infer<
  typeof RecordingSessionStatusSchema
>;
export type RecordingSessionCreateResponse = z.infer<
  typeof RecordingSessionCreateResponseSchema
>;
export type RecordingEventBatchResponse = z.infer<
  typeof RecordingEventBatchResponseSchema
>;
export type RecordingSessionCompleteResponse = z.infer<
  typeof RecordingSessionCompleteResponseSchema
>;
export type RecordingSessionMetadataResponse = z.infer<
  typeof RecordingSessionMetadataResponseSchema
>;
