import { z } from 'zod';

import { MAX_RECORDING_EVENTS } from './constants.js';
import { RecordingEventSchema } from './events.js';
import {
  OriginSchema,
  RecordingEventCountSchema,
  RecordingLastSequenceSchema,
  TimestampSchema,
  UuidSchema,
} from './primitives.js';
import {
  createRecordingPrivacySummary,
  RecordingPrivacySummarySchema,
} from './privacy-summary.js';

function summariesMatch(
  left: z.infer<typeof RecordingPrivacySummarySchema>,
  right: z.infer<typeof RecordingPrivacySummarySchema>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const RecordingArtifactSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    clientSessionId: UuidSchema,
    targetOrigin: OriginSchema,
    startedAt: TimestampSchema,
    stoppedAt: TimestampSchema,
    eventCount: RecordingEventCountSchema,
    lastSequence: RecordingLastSequenceSchema,
    events: z.array(RecordingEventSchema).max(MAX_RECORDING_EVENTS),
    privacySummary: RecordingPrivacySummarySchema,
  })
  .superRefine((artifact, context) => {
    if (Date.parse(artifact.stoppedAt) < Date.parse(artifact.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['stoppedAt'],
        message: 'Stopped time must not precede started time.',
      });
    }

    if (artifact.eventCount !== artifact.events.length) {
      context.addIssue({
        code: 'custom',
        path: ['eventCount'],
        message: 'Event count must match the events array.',
      });
    }

    const expectedLastSequence = artifact.events.at(-1)?.sequence ?? 0;
    if (artifact.lastSequence !== expectedLastSequence) {
      context.addIssue({
        code: 'custom',
        path: ['lastSequence'],
        message: 'Last sequence must match the final event.',
      });
    }

    const eventIds = new Set<string>();
    artifact.events.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sequence'],
          message: 'Artifact event sequence must be contiguous from one.',
        });
      }
      if (eventIds.has(event.eventId)) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'eventId'],
          message: 'Artifact event IDs must be unique.',
        });
      }
      eventIds.add(event.eventId);

      if (event.sessionId !== artifact.clientSessionId) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sessionId'],
          message: 'Event session must match the artifact client session.',
        });
      }
      if (event.origin !== artifact.targetOrigin) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'origin'],
          message: 'Event origin must match the artifact target origin.',
        });
      }
    });

    const expectedSummary = createRecordingPrivacySummary(artifact.events);
    if (!summariesMatch(expectedSummary, artifact.privacySummary)) {
      context.addIssue({
        code: 'custom',
        path: ['privacySummary'],
        message: 'Privacy summary must match the artifact events.',
      });
    }
  });

export type RecordingArtifact = z.infer<typeof RecordingArtifactSchema>;
