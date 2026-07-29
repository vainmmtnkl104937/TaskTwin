import { LocatorBundleSchema } from '@tasktwin/locator-engine';
import {
  MAX_CONTROL_VALUE_LENGTH,
  MAX_INPUT_VALUE_LENGTH,
  MAX_RECORDING_EVENTS,
  MAX_TARGET_METADATA_LENGTH,
  MAX_TEXT_PREVIEW_LENGTH,
  ClickEventPayloadSchema,
  RecordingEventCandidateSchema,
  RecordingEventSchema,
  RecordingEventTypeSchema,
  RecordingTargetSnapshotSchema,
  type RecordingEvent,
  type RecordingEventCandidate,
  type RecordingEventType,
  type RecordingTargetSnapshot,
} from '@tasktwin/recording-schema';
import { z } from 'zod';

import {
  RecorderErrorSchema,
  RecordingSessionStateSchema,
} from './contracts.js';

export {
  MAX_CONTROL_VALUE_LENGTH,
  MAX_INPUT_VALUE_LENGTH,
  MAX_RECORDING_EVENTS,
  MAX_TARGET_METADATA_LENGTH,
  MAX_TEXT_PREVIEW_LENGTH,
  ClickEventPayloadSchema,
  RecordingEventCandidateSchema,
  RecordingEventSchema,
  RecordingEventTypeSchema,
  RecordingTargetSnapshotSchema,
};
export type {
  RecordingEvent,
  RecordingEventCandidate,
  RecordingEventType,
  RecordingTargetSnapshot,
};

const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();
const ControlValueSchema = z.string().max(MAX_CONTROL_VALUE_LENGTH);

const OriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  }, 'Must be an HTTP or HTTPS origin.');

export const MaskedInputReasonSchema = z.enum([
  'password',
  'current-password',
  'new-password',
  'one-time-code',
]);

export const UnmaskedTextInputPayloadSchema = z.strictObject({
  masked: z.literal(false),
  maskedReason: z.null(),
  value: z.string().max(MAX_INPUT_VALUE_LENGTH),
  truncated: z.boolean(),
});

export const MaskedTextInputPayloadSchema = z.strictObject({
  masked: z.literal(true),
  maskedReason: MaskedInputReasonSchema,
  value: z.null(),
  truncated: z.literal(false),
});

export const LegacyTextInputEventPayloadSchema = z.discriminatedUnion(
  'masked',
  [UnmaskedTextInputPayloadSchema, MaskedTextInputPayloadSchema],
);

export const LegacySelectEventPayloadSchema = z.strictObject({
  value: ControlValueSchema,
  label: ControlValueSchema,
  truncated: z.boolean(),
});

export const LegacyCheckboxEventPayloadSchema = z.strictObject({
  checked: z.boolean(),
});

export const LegacyRadioEventPayloadSchema = z.strictObject({
  checked: z.literal(true),
  value: ControlValueSchema.nullable(),
  truncated: z.boolean(),
});

const acceptedEventEnvelopeShape = {
  eventId: UuidSchema,
  sessionId: UuidSchema,
  sequence: z.number().int().positive(),
  tabId: z.number().int().nonnegative(),
  origin: OriginSchema,
  recordedAt: TimestampSchema,
};

const legacyV2CandidateBaseShape = {
  schemaVersion: z.literal(2),
  occurredAt: TimestampSchema,
  target: RecordingTargetSnapshotSchema,
  locatorBundle: LocatorBundleSchema,
};

export const LegacyV2RecordingEventSchema = z.discriminatedUnion('eventType', [
  z.strictObject({
    ...legacyV2CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('click'),
    payload: ClickEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyV2CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('text-input'),
    payload: LegacyTextInputEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyV2CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('select'),
    payload: LegacySelectEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyV2CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('checkbox'),
    payload: LegacyCheckboxEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyV2CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('radio'),
    payload: LegacyRadioEventPayloadSchema,
  }),
]);

const legacyV1CandidateBaseShape = {
  schemaVersion: z.literal(1),
  occurredAt: TimestampSchema,
  target: RecordingTargetSnapshotSchema,
};

export const LegacyRecordingEventSchema = z.discriminatedUnion('eventType', [
  z.strictObject({
    ...legacyV1CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('click'),
    payload: ClickEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyV1CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('text-input'),
    payload: LegacyTextInputEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyV1CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('select'),
    payload: LegacySelectEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyV1CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('checkbox'),
    payload: LegacyCheckboxEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyV1CandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('radio'),
    payload: LegacyRadioEventPayloadSchema,
  }),
]);

function validateTimeline(
  timeline: {
    sessionId: string;
    nextSequence: number;
    events: ReadonlyArray<{ sessionId: string; sequence: number }>;
  },
  context: z.RefinementCtx,
): void {
  timeline.events.forEach((event, index) => {
    if (event.sessionId !== timeline.sessionId) {
      context.addIssue({
        code: 'custom',
        path: ['events', index, 'sessionId'],
        message: 'Event session must match the timeline session.',
      });
    }
    if (event.sequence !== index + 1) {
      context.addIssue({
        code: 'custom',
        path: ['events', index, 'sequence'],
        message: 'Event sequence must be ordered and contiguous.',
      });
    }
  });

  if (timeline.nextSequence !== timeline.events.length + 1) {
    context.addIssue({
      code: 'custom',
      path: ['nextSequence'],
      message: 'Next sequence must follow the final stored event.',
    });
  }
}

export const LegacyRecordingTimelineSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sessionId: UuidSchema,
    nextSequence: z.number().int().positive(),
    events: z.array(LegacyRecordingEventSchema).max(MAX_RECORDING_EVENTS),
  })
  .superRefine(validateTimeline);

export const LegacyV2RecordingTimelineSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    sessionId: UuidSchema,
    nextSequence: z.number().int().positive(),
    events: z.array(LegacyV2RecordingEventSchema).max(MAX_RECORDING_EVENTS),
  })
  .superRefine(validateTimeline);

export const RecordingTimelineSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    sessionId: UuidSchema,
    nextSequence: z.number().int().positive(),
    events: z.array(RecordingEventSchema).max(MAX_RECORDING_EVENTS),
  })
  .superRefine(validateTimeline);

export const PersistedRecordingTimelineSchema = z.union([
  RecordingTimelineSchema,
  LegacyV2RecordingTimelineSchema,
  LegacyRecordingTimelineSchema,
]);

export const RecordingTimelineSummarySchema = z.strictObject({
  eventCount: z.number().int().min(0).max(MAX_RECORDING_EVENTS),
  latestEventType: RecordingEventTypeSchema.nullable(),
});

export const RecordingEventCandidateMessageSchema = z.strictObject({
  type: z.literal('recorder/event-candidate'),
  candidate: RecordingEventCandidateSchema,
});

export const RecordingEventCandidateSuccessResponseSchema = z.strictObject({
  success: z.literal(true),
  sequence: z.number().int().positive(),
  summary: RecordingTimelineSummarySchema,
});

export const RecordingEventCandidateFailureResponseSchema = z.strictObject({
  success: z.literal(false),
  error: RecorderErrorSchema,
});

export const RecordingEventCandidateResponseSchema = z.discriminatedUnion(
  'success',
  [
    RecordingEventCandidateSuccessResponseSchema,
    RecordingEventCandidateFailureResponseSchema,
  ],
);

export const FlushPendingReasonSchema = z.enum(['pause', 'stop']);

export const FlushPendingNotificationSchema = z.strictObject({
  type: z.literal('recorder/flush-pending'),
  sessionId: UuidSchema,
  reason: FlushPendingReasonSchema,
});

export const FlushPendingSuccessResponseSchema = z.strictObject({
  success: z.literal(true),
  flushed: z.literal(true),
});

export const FlushPendingFailureResponseSchema = z.strictObject({
  success: z.literal(false),
  error: RecorderErrorSchema,
});

export const FlushPendingResponseSchema = z.discriminatedUnion('success', [
  FlushPendingSuccessResponseSchema,
  FlushPendingFailureResponseSchema,
]);

export const TimelineSummaryChangedNotificationSchema = z.strictObject({
  type: z.literal('recorder/timeline-summary-changed'),
  summary: RecordingTimelineSummarySchema,
});

export const RecorderPopupSuccessResponseSchema = z.strictObject({
  success: z.literal(true),
  state: RecordingSessionStateSchema,
  timelineSummary: RecordingTimelineSummarySchema,
});

export const RecorderPopupFailureResponseSchema = z.strictObject({
  success: z.literal(false),
  error: RecorderErrorSchema,
  state: RecordingSessionStateSchema.nullable(),
  timelineSummary: RecordingTimelineSummarySchema,
});

export const RecorderPopupResponseSchema = z.discriminatedUnion('success', [
  RecorderPopupSuccessResponseSchema,
  RecorderPopupFailureResponseSchema,
]);

export type RecordingTimeline = z.infer<typeof RecordingTimelineSchema>;
export type LegacyRecordingTimeline = z.infer<
  typeof LegacyRecordingTimelineSchema
>;
export type LegacyV2RecordingTimeline = z.infer<
  typeof LegacyV2RecordingTimelineSchema
>;
export type PersistedRecordingTimeline = z.infer<
  typeof PersistedRecordingTimelineSchema
>;
export type RecordingTimelineSummary = z.infer<
  typeof RecordingTimelineSummarySchema
>;
export type RecordingEventCandidateMessage = z.infer<
  typeof RecordingEventCandidateMessageSchema
>;
export type RecordingEventCandidateResponse = z.infer<
  typeof RecordingEventCandidateResponseSchema
>;
export type FlushPendingReason = z.infer<typeof FlushPendingReasonSchema>;
export type FlushPendingNotification = z.infer<
  typeof FlushPendingNotificationSchema
>;
export type FlushPendingResponse = z.infer<typeof FlushPendingResponseSchema>;
export type TimelineSummaryChangedNotification = z.infer<
  typeof TimelineSummaryChangedNotificationSchema
>;
export type RecorderPopupResponse = z.infer<typeof RecorderPopupResponseSchema>;
