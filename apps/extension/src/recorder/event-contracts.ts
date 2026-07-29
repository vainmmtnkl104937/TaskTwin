import { LocatorBundleSchema } from '@tasktwin/locator-engine';
import { z } from 'zod';

import {
  RecorderErrorSchema,
  RecordingSessionStateSchema,
} from './contracts.js';

export const MAX_RECORDING_EVENTS = 1_000;
export const MAX_INPUT_VALUE_LENGTH = 2_048;
export const MAX_CONTROL_VALUE_LENGTH = 512;
export const MAX_TARGET_METADATA_LENGTH = 160;
export const MAX_TEXT_PREVIEW_LENGTH = 120;

const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();
const BoundedMetadataSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TARGET_METADATA_LENGTH);
const NullableMetadataSchema = BoundedMetadataSchema.nullable();
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

export const RecordingEventTypeSchema = z.enum([
  'click',
  'text-input',
  'select',
  'checkbox',
  'radio',
]);

export const TestIdAttributeSchema = z.enum([
  'data-testid',
  'data-test',
  'data-cy',
  'data-qa',
]);

export const TestIdCandidateSchema = z.strictObject({
  attribute: TestIdAttributeSchema,
  value: BoundedMetadataSchema,
});

export const RecordingTargetSnapshotSchema = z.strictObject({
  tagName: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-z][a-z0-9-]*$/),
  inputType: NullableMetadataSchema,
  role: NullableMetadataSchema,
  id: NullableMetadataSchema,
  name: NullableMetadataSchema,
  labelText: NullableMetadataSchema,
  accessibleName: NullableMetadataSchema,
  placeholder: NullableMetadataSchema,
  textPreview: z.string().trim().min(1).max(MAX_TEXT_PREVIEW_LENGTH).nullable(),
  testIdCandidates: z.array(TestIdCandidateSchema).max(4),
});

export const MaskedInputReasonSchema = z.enum([
  'password',
  'current-password',
  'new-password',
  'one-time-code',
]);

export const ClickEventPayloadSchema = z.strictObject({
  activation: z.literal('primary'),
});

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

export const TextInputEventPayloadSchema = z.discriminatedUnion('masked', [
  UnmaskedTextInputPayloadSchema,
  MaskedTextInputPayloadSchema,
]);

export const SelectEventPayloadSchema = z.strictObject({
  value: ControlValueSchema,
  label: ControlValueSchema,
  truncated: z.boolean(),
});

export const CheckboxEventPayloadSchema = z.strictObject({
  checked: z.boolean(),
});

export const RadioEventPayloadSchema = z.strictObject({
  checked: z.literal(true),
  value: ControlValueSchema.nullable(),
  truncated: z.boolean(),
});

const candidateBaseShape = {
  schemaVersion: z.literal(2),
  occurredAt: TimestampSchema,
  target: RecordingTargetSnapshotSchema,
  locatorBundle: LocatorBundleSchema,
};

export const ClickEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('click'),
  payload: ClickEventPayloadSchema,
});

export const TextInputEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('text-input'),
  payload: TextInputEventPayloadSchema,
});

export const SelectEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('select'),
  payload: SelectEventPayloadSchema,
});

export const CheckboxEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('checkbox'),
  payload: CheckboxEventPayloadSchema,
});

export const RadioEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('radio'),
  payload: RadioEventPayloadSchema,
});

export const RecordingEventCandidateSchema = z.discriminatedUnion('eventType', [
  ClickEventCandidateSchema,
  TextInputEventCandidateSchema,
  SelectEventCandidateSchema,
  CheckboxEventCandidateSchema,
  RadioEventCandidateSchema,
]);

const acceptedEventEnvelopeShape = {
  eventId: UuidSchema,
  sessionId: UuidSchema,
  sequence: z.number().int().positive(),
  tabId: z.number().int().nonnegative(),
  origin: OriginSchema,
  recordedAt: TimestampSchema,
};

export const ClickRecordingEventSchema = z.strictObject({
  ...candidateBaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('click'),
  payload: ClickEventPayloadSchema,
});

export const TextInputRecordingEventSchema = z.strictObject({
  ...candidateBaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('text-input'),
  payload: TextInputEventPayloadSchema,
});

export const SelectRecordingEventSchema = z.strictObject({
  ...candidateBaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('select'),
  payload: SelectEventPayloadSchema,
});

export const CheckboxRecordingEventSchema = z.strictObject({
  ...candidateBaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('checkbox'),
  payload: CheckboxEventPayloadSchema,
});

export const RadioRecordingEventSchema = z.strictObject({
  ...candidateBaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('radio'),
  payload: RadioEventPayloadSchema,
});

export const RecordingEventSchema = z.discriminatedUnion('eventType', [
  ClickRecordingEventSchema,
  TextInputRecordingEventSchema,
  SelectRecordingEventSchema,
  CheckboxRecordingEventSchema,
  RadioRecordingEventSchema,
]);

const legacyCandidateBaseShape = {
  schemaVersion: z.literal(1),
  occurredAt: TimestampSchema,
  target: RecordingTargetSnapshotSchema,
};

export const LegacyRecordingEventSchema = z.discriminatedUnion('eventType', [
  z.strictObject({
    ...legacyCandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('click'),
    payload: ClickEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyCandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('text-input'),
    payload: TextInputEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyCandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('select'),
    payload: SelectEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyCandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('checkbox'),
    payload: CheckboxEventPayloadSchema,
  }),
  z.strictObject({
    ...legacyCandidateBaseShape,
    ...acceptedEventEnvelopeShape,
    eventType: z.literal('radio'),
    payload: RadioEventPayloadSchema,
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

export const RecordingTimelineSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    sessionId: UuidSchema,
    nextSequence: z.number().int().positive(),
    events: z.array(RecordingEventSchema).max(MAX_RECORDING_EVENTS),
  })
  .superRefine(validateTimeline);

export const PersistedRecordingTimelineSchema = z.union([
  RecordingTimelineSchema,
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

export type RecordingEventType = z.infer<typeof RecordingEventTypeSchema>;
export type RecordingTargetSnapshot = z.infer<
  typeof RecordingTargetSnapshotSchema
>;
export type MaskedInputReason = z.infer<typeof MaskedInputReasonSchema>;
export type RecordingEventCandidate = z.infer<
  typeof RecordingEventCandidateSchema
>;
export type RecordingEvent = z.infer<typeof RecordingEventSchema>;
export type RecordingTimeline = z.infer<typeof RecordingTimelineSchema>;
export type LegacyRecordingTimeline = z.infer<
  typeof LegacyRecordingTimelineSchema
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
