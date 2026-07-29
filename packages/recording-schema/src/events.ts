import {
  LocatorBundleSchema,
  type LocatorBundle,
} from '@tasktwin/locator-engine';
import {
  classifyPrivacy,
  containsSensitiveLiteral,
  detectSensitiveLiteralKinds,
  PrivacyDecisionSchema,
  type PrivacyDecision,
} from '@tasktwin/privacy-engine';
import { z } from 'zod';

import {
  MAX_CONTROL_VALUE_LENGTH,
  MAX_INPUT_VALUE_LENGTH,
  MAX_TARGET_METADATA_LENGTH,
  MAX_TEXT_PREVIEW_LENGTH,
} from './constants.js';
import {
  OriginSchema,
  RecordingSequenceSchema,
  TimestampSchema,
  UuidSchema,
} from './primitives.js';

const BoundedMetadataSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TARGET_METADATA_LENGTH);
const NullableMetadataSchema = BoundedMetadataSchema.nullable();
const ControlValueSchema = z.string().max(MAX_CONTROL_VALUE_LENGTH);

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

export const PrivacyCapturePolicySchema = z.enum(['allow', 'mask', 'block']);

export const ClickEventPayloadSchema = z.strictObject({
  activation: z.literal('primary'),
});

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

export const MaskedTextInputPayloadSchema = MaskedTextInputV3PayloadSchema;

export const BlockedValuePayloadSchema = z.strictObject({
  capturePolicy: z.literal('block'),
});

export const TextInputV3PayloadSchema = z.discriminatedUnion('capturePolicy', [
  AllowedTextInputPayloadSchema,
  MaskedTextInputV3PayloadSchema,
  BlockedValuePayloadSchema,
]);

export const TextInputEventPayloadSchema = TextInputV3PayloadSchema;

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

export const SelectEventPayloadSchema = SelectV3PayloadSchema;

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

export const CheckboxEventPayloadSchema = CheckboxV3PayloadSchema;

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

export const RadioEventPayloadSchema = RadioV3PayloadSchema;

const candidateBaseShape = {
  schemaVersion: z.literal(3),
  occurredAt: TimestampSchema,
  target: RecordingTargetSnapshotSchema,
  locatorBundle: LocatorBundleSchema,
  privacyDecision: PrivacyDecisionSchema,
};

export const ClickRecordingEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('click'),
  payload: ClickEventPayloadSchema,
});

export const TextInputRecordingEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('text-input'),
  payload: TextInputEventPayloadSchema,
});

export const SelectRecordingEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('select'),
  payload: SelectEventPayloadSchema,
});

export const CheckboxRecordingEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('checkbox'),
  payload: CheckboxEventPayloadSchema,
});

export const RadioRecordingEventCandidateSchema = z.strictObject({
  ...candidateBaseShape,
  eventType: z.literal('radio'),
  payload: RadioEventPayloadSchema,
});

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

function validatePrivacyPolicy(
  event: {
    eventType: string;
    privacyDecision: {
      sensitivity: PrivacyDecision['sensitivity'];
      policy: PrivacyDecision['policy'];
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

  const independentlyClassifiedTarget = classifyPrivacy({
    schemaVersion: 1,
    tagName: event.target.tagName,
    inputType: event.target.inputType,
    autocomplete: null,
    name: event.target.name,
    id: event.target.id,
    labelText: event.target.labelText,
    accessibleName: event.target.accessibleName,
    placeholder: event.target.placeholder,
    role: event.target.role,
  });
  const independentlyRequiredPolicy =
    independentlyClassifiedTarget.sensitivity === 'authentication' ||
    independentlyClassifiedTarget.sensitivity === 'financial' ||
    independentlyClassifiedTarget.sensitivity === 'identity' ||
    independentlyClassifiedTarget.sensitivity === 'health'
      ? 'block'
      : independentlyClassifiedTarget.sensitivity === 'unknown-sensitive'
        ? 'mask'
        : 'allow';
  const policyRank = {
    allow: 0,
    mask: 1,
    block: 2,
  } as const;

  if (
    independentlyClassifiedTarget.sensitivity !== 'public' &&
    independentlyClassifiedTarget.sensitivity !== 'general' &&
    (sensitivity === 'public' || sensitivity === 'general')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['privacyDecision', 'sensitivity'],
      message:
        'Declared sensitivity must not weaken deterministic target classification.',
    });
  }

  if (policyRank[policy] < policyRank[independentlyRequiredPolicy]) {
    context.addIssue({
      code: 'custom',
      path: ['privacyDecision', 'policy'],
      message:
        'Declared policy must not weaken deterministic target classification.',
    });
  }

  const allowedPayloadValues: string[] = [];
  if (
    'capturePolicy' in event.payload &&
    event.payload.capturePolicy === 'allow'
  ) {
    if ('value' in event.payload && typeof event.payload.value === 'string') {
      allowedPayloadValues.push(event.payload.value);
    }
    if ('label' in event.payload && typeof event.payload.label === 'string') {
      allowedPayloadValues.push(event.payload.label);
    }
  }

  const literalKinds = new Set(
    allowedPayloadValues.flatMap((value) => detectSensitiveLiteralKinds(value)),
  );
  if (
    literalKinds.has('authentication') ||
    literalKinds.has('financial-or-identity')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message:
        'Allowed payloads must not contain authentication, financial, or identity literals.',
    });
  }
  if (
    literalKinds.has('personal') &&
    (sensitivity !== 'personal' || policy !== 'allow')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Personal literals require an explicit personal allow decision.',
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

export const RecordingEventCandidateSchema = z
  .discriminatedUnion('eventType', [
    ClickRecordingEventCandidateSchema,
    TextInputRecordingEventCandidateSchema,
    SelectRecordingEventCandidateSchema,
    CheckboxRecordingEventCandidateSchema,
    RadioRecordingEventCandidateSchema,
  ])
  .superRefine(validatePrivacyPolicy);

const acceptedEventEnvelopeShape = {
  eventId: UuidSchema,
  sessionId: UuidSchema,
  sequence: RecordingSequenceSchema,
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

export const RecordingEventSchema = z
  .discriminatedUnion('eventType', [
    ClickRecordingEventSchema,
    TextInputRecordingEventSchema,
    SelectRecordingEventSchema,
    CheckboxRecordingEventSchema,
    RadioRecordingEventSchema,
  ])
  .superRefine(validatePrivacyPolicy);

export type RecordingEventType = z.infer<typeof RecordingEventTypeSchema>;
export type RecordingTargetSnapshot = z.infer<
  typeof RecordingTargetSnapshotSchema
>;
export type RecordingEventCandidate = z.infer<
  typeof RecordingEventCandidateSchema
>;
export type RecordingEvent = z.infer<typeof RecordingEventSchema>;
