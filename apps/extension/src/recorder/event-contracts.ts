import {
  LocatorBundleSchema,
  type LocatorBundle,
} from '@tasktwin/locator-engine';
import {
  containsSensitiveLiteral,
  PrivacyDecisionSchema,
} from '@tasktwin/privacy-engine';
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

export const LegacyV2RecordingEventCandidateSchema = z.discriminatedUnion(
  'eventType',
  [
    ClickEventCandidateSchema,
    TextInputEventCandidateSchema,
    SelectEventCandidateSchema,
    CheckboxEventCandidateSchema,
    RadioEventCandidateSchema,
  ],
);

export const PrivacyCapturePolicySchema = z.enum(['allow', 'mask', 'block']);

export const AllowedTextInputPayloadSchema = z.strictObject({
  capturePolicy: z.literal('allow'),
  value: z.string().max(MAX_INPUT_VALUE_LENGTH),
  truncated: z.boolean(),
});

export const MaskedTextInputV3PayloadSchema = z.strictObject({
  capturePolicy: z.literal('mask'),
  value: z.null(),
  truncated: z.literal(false),
});

export const BlockedValuePayloadSchema = z.strictObject({
  capturePolicy: z.literal('block'),
});

export const TextInputV3PayloadSchema = z.discriminatedUnion('capturePolicy', [
  AllowedTextInputPayloadSchema,
  MaskedTextInputV3PayloadSchema,
  BlockedValuePayloadSchema,
]);

export const AllowedSelectPayloadSchema = z.strictObject({
  capturePolicy: z.literal('allow'),
  value: ControlValueSchema,
  label: ControlValueSchema,
  truncated: z.boolean(),
});

export const MaskedSelectPayloadSchema = z.strictObject({
  capturePolicy: z.literal('mask'),
  value: z.null(),
  label: z.null(),
  truncated: z.literal(false),
});

export const SelectV3PayloadSchema = z.discriminatedUnion('capturePolicy', [
  AllowedSelectPayloadSchema,
  MaskedSelectPayloadSchema,
  BlockedValuePayloadSchema,
]);

export const AllowedCheckboxPayloadSchema = z.strictObject({
  capturePolicy: z.literal('allow'),
  checked: z.boolean(),
});

export const MaskedCheckboxPayloadSchema = z.strictObject({
  capturePolicy: z.literal('mask'),
  checked: z.null(),
});

export const CheckboxV3PayloadSchema = z.discriminatedUnion('capturePolicy', [
  AllowedCheckboxPayloadSchema,
  MaskedCheckboxPayloadSchema,
  BlockedValuePayloadSchema,
]);

export const AllowedRadioPayloadSchema = z.strictObject({
  capturePolicy: z.literal('allow'),
  checked: z.literal(true),
  value: ControlValueSchema.nullable(),
  truncated: z.boolean(),
});

export const MaskedRadioPayloadSchema = z.strictObject({
  capturePolicy: z.literal('mask'),
  checked: z.null(),
  value: z.null(),
  truncated: z.literal(false),
});

export const RadioV3PayloadSchema = z.discriminatedUnion('capturePolicy', [
  AllowedRadioPayloadSchema,
  MaskedRadioPayloadSchema,
  BlockedValuePayloadSchema,
]);

const candidateV3BaseShape = {
  schemaVersion: z.literal(3),
  occurredAt: TimestampSchema,
  target: RecordingTargetSnapshotSchema,
  locatorBundle: LocatorBundleSchema,
  privacyDecision: PrivacyDecisionSchema,
};

const ClickEventCandidateV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  eventType: z.literal('click'),
  payload: ClickEventPayloadSchema,
});

const TextInputEventCandidateV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  eventType: z.literal('text-input'),
  payload: TextInputV3PayloadSchema,
});

const SelectEventCandidateV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  eventType: z.literal('select'),
  payload: SelectV3PayloadSchema,
});

const CheckboxEventCandidateV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  eventType: z.literal('checkbox'),
  payload: CheckboxV3PayloadSchema,
});

const RadioEventCandidateV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  eventType: z.literal('radio'),
  payload: RadioV3PayloadSchema,
});

function validatePrivacyPolicy(
  event: {
    eventType: string;
    privacyDecision: {
      sensitivity: string;
      policy: string;
    };
    payload: object;
    target: z.infer<typeof RecordingTargetSnapshotSchema>;
    locatorBundle: LocatorBundle;
  },
  context: z.RefinementCtx,
): void {
  const { policy, sensitivity } = event.privacyDecision;
  const requiredPolicy =
    sensitivity === 'authentication' ||
    sensitivity === 'financial' ||
    sensitivity === 'identity' ||
    sensitivity === 'health'
      ? 'block'
      : sensitivity === 'unknown-sensitive'
        ? 'mask'
        : null;

  if (requiredPolicy !== null && policy !== requiredPolicy) {
    context.addIssue({
      code: 'custom',
      path: ['privacyDecision', 'policy'],
      message: `The ${sensitivity} sensitivity requires the ${requiredPolicy} policy.`,
    });
  }

  if (
    (sensitivity === 'public' || sensitivity === 'general') &&
    policy !== 'allow'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['privacyDecision', 'policy'],
      message: `The ${sensitivity} sensitivity requires the allow policy.`,
    });
  }

  if (sensitivity === 'personal' && policy !== 'allow' && policy !== 'mask') {
    context.addIssue({
      code: 'custom',
      path: ['privacyDecision', 'policy'],
      message: 'Personal data may only use the allow or mask policy.',
    });
  }

  if (
    event.eventType !== 'click' &&
    (!('capturePolicy' in event.payload) ||
      event.payload.capturePolicy !== policy)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['payload', 'capturePolicy'],
      message: 'Payload policy must match the privacy decision.',
    });
  }

  const targetValues = [
    event.target.id,
    event.target.name,
    event.target.labelText,
    event.target.accessibleName,
    event.target.placeholder,
    event.target.textPreview,
    ...event.target.testIdCandidates.map((candidate) => candidate.value),
  ];
  if (
    targetValues.some(
      (value) => value !== null && containsSensitiveLiteral(value),
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['target'],
      message: 'Target metadata must not contain a sensitive literal.',
    });
  }

  const locatorCandidates = [
    event.locatorBundle.primary,
    ...event.locatorBundle.fallbacks,
  ];
  if (
    locatorCandidates.some((candidate) =>
      locatorTextValues(candidate.locator).some(containsSensitiveLiteral),
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['locatorBundle'],
      message: 'Locator metadata must not contain a sensitive literal.',
    });
  }
}

function locatorTextValues(
  locator: LocatorBundle['primary']['locator'],
): string[] {
  switch (locator.kind) {
    case 'testId':
      return [locator.value];
    case 'role':
      return locator.name === undefined
        ? [locator.role]
        : [locator.role, locator.name];
    case 'label':
    case 'text':
    case 'placeholder':
      return [locator.value];
    case 'css':
      return [locator.selector];
  }
}

export const RecordingEventCandidateSchema = z
  .discriminatedUnion('eventType', [
    ClickEventCandidateV3Schema,
    TextInputEventCandidateV3Schema,
    SelectEventCandidateV3Schema,
    CheckboxEventCandidateV3Schema,
    RadioEventCandidateV3Schema,
  ])
  .superRefine(validatePrivacyPolicy);

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

export const LegacyV2RecordingEventSchema = z.discriminatedUnion('eventType', [
  ClickRecordingEventSchema,
  TextInputRecordingEventSchema,
  SelectRecordingEventSchema,
  CheckboxRecordingEventSchema,
  RadioRecordingEventSchema,
]);

const ClickRecordingEventV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('click'),
  payload: ClickEventPayloadSchema,
});

const TextInputRecordingEventV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('text-input'),
  payload: TextInputV3PayloadSchema,
});

const SelectRecordingEventV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('select'),
  payload: SelectV3PayloadSchema,
});

const CheckboxRecordingEventV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('checkbox'),
  payload: CheckboxV3PayloadSchema,
});

const RadioRecordingEventV3Schema = z.strictObject({
  ...candidateV3BaseShape,
  ...acceptedEventEnvelopeShape,
  eventType: z.literal('radio'),
  payload: RadioV3PayloadSchema,
});

export const RecordingEventSchema = z
  .discriminatedUnion('eventType', [
    ClickRecordingEventV3Schema,
    TextInputRecordingEventV3Schema,
    SelectRecordingEventV3Schema,
    CheckboxRecordingEventV3Schema,
    RadioRecordingEventV3Schema,
  ])
  .superRefine(validatePrivacyPolicy);

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
