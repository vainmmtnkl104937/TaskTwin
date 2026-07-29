import {
  createRecordingPrivacySummary,
  RecordingArtifactSchema,
  RecordingEventSchema,
  type RecordingArtifact,
  type RecordingEvent,
} from '@tasktwin/recording-schema';

const clientSessionId = '11111111-1111-4111-8111-111111111111';
const origin = 'https://example.test';

function eventId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function locatorBundle(testId: string, confidence: 'high' | 'low' = 'high') {
  return {
    schemaVersion: 1,
    primary: {
      locator: {
        kind: 'testId',
        attribute: 'data-testid',
        value: testId,
      },
      score: confidence === 'low' ? 40 : 98,
      matchCount: 1,
      unique: true,
      source: 'testId',
      reasons: [
        {
          code: 'STRONG_TEST_ID',
          message: 'Uses an allowlisted test identifier.',
        },
        {
          code: 'UNIQUE_MATCH',
          message: 'Matches exactly one element.',
        },
      ],
    },
    fallbacks: [],
    confidence,
    generatedAt: '2026-07-29T10:00:00.000Z',
  };
}

const generalDecision = {
  schemaVersion: 1,
  sensitivity: 'general',
  policy: 'allow',
  confidence: 'low',
  matchedRules: ['GENERAL_NO_SENSITIVE_SIGNAL'],
  reasons: ['No supported sensitive metadata rule matched.'],
} as const;

function baseEvent(
  sequence: number,
  testId: string,
  target: Partial<RecordingEvent['target']>,
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    occurredAt: `2026-07-29T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    target: {
      tagName: 'input',
      inputType: 'text',
      role: 'textbox',
      id: null,
      name: null,
      labelText: null,
      accessibleName: null,
      placeholder: null,
      textPreview: null,
      testIdCandidates: [{ attribute: 'data-testid', value: testId }],
      ...target,
    },
    locatorBundle: locatorBundle(testId),
    privacyDecision: generalDecision,
    eventId: eventId(sequence),
    sessionId: clientSessionId,
    sequence,
    tabId: 7,
    origin,
    recordedAt: `2026-07-29T10:00:${String(sequence).padStart(2, '0')}.100Z`,
  };
}

export function allowedTextEvent(
  sequence: number,
  value = 'safe note',
  label = 'Notes',
): RecordingEvent {
  return RecordingEventSchema.parse({
    ...baseEvent(sequence, `notes-${sequence}`, {
      name: 'notes',
      labelText: label,
      accessibleName: label,
    }),
    eventType: 'text-input',
    payload: { capturePolicy: 'allow', value, truncated: false },
  });
}

export function maskedPersonalEvent(
  sequence: number,
  structuralName = 'customerEmail',
): RecordingEvent {
  const label = structuralName === 'customerEmail' ? 'Customer email' : 'Email';
  return RecordingEventSchema.parse({
    ...baseEvent(sequence, `email-${sequence}`, {
      inputType: 'email',
      name: structuralName,
      labelText: label,
      accessibleName: label,
    }),
    privacyDecision: {
      schemaVersion: 1,
      sensitivity: 'personal',
      policy: 'mask',
      confidence: 'high',
      matchedRules: ['PERSONAL_INPUT_TYPE'],
      reasons: ['Deterministic personal metadata rules matched.'],
    },
    eventType: 'text-input',
    payload: { capturePolicy: 'mask', value: null, truncated: false },
  });
}

export function blockedPasswordEvent(sequence: number): RecordingEvent {
  return RecordingEventSchema.parse({
    ...baseEvent(sequence, `password-${sequence}`, {
      inputType: 'password',
      name: 'accountPassword',
      labelText: 'Password',
      accessibleName: 'Password',
    }),
    privacyDecision: {
      schemaVersion: 1,
      sensitivity: 'authentication',
      policy: 'block',
      confidence: 'high',
      matchedRules: ['AUTH_PASSWORD_TYPE'],
      reasons: ['Deterministic authentication metadata rules matched.'],
    },
    eventType: 'text-input',
    payload: { capturePolicy: 'block' },
  });
}

export function clickEvent(
  sequence: number,
  confidence: 'high' | 'low' = 'high',
): RecordingEvent {
  const testId = `button-${sequence}`;
  return RecordingEventSchema.parse({
    ...baseEvent(sequence, testId, {
      tagName: 'button',
      inputType: null,
      role: 'button',
      labelText: null,
      accessibleName: 'Add customer',
      textPreview: 'Add customer',
    }),
    locatorBundle: locatorBundle(testId, confidence),
    eventType: 'click',
    payload: { activation: 'primary' },
  });
}

export function selectEvent(
  sequence: number,
  value = 'premium',
  label = 'Premium',
): RecordingEvent {
  return RecordingEventSchema.parse({
    ...baseEvent(sequence, `service-${sequence}`, {
      tagName: 'select',
      inputType: null,
      role: 'combobox',
      name: 'servicePackage',
      labelText: 'Service package',
      accessibleName: 'Service package',
    }),
    eventType: 'select',
    payload: {
      capturePolicy: 'allow',
      value,
      label,
      truncated: false,
    },
  });
}

export function checkboxEvent(
  sequence: number,
  checked: boolean,
): RecordingEvent {
  return RecordingEventSchema.parse({
    ...baseEvent(sequence, `welcome-${sequence}`, {
      inputType: 'checkbox',
      role: 'checkbox',
      name: 'sendWelcomeEmail',
      labelText: 'Send welcome email',
      accessibleName: 'Send welcome email',
    }),
    privacyDecision: {
      schemaVersion: 1,
      sensitivity: 'personal',
      policy: 'allow',
      confidence: 'high',
      matchedRules: ['PERSONAL_METADATA'],
      reasons: ['Deterministic personal metadata rules matched.'],
    },
    eventType: 'checkbox',
    payload: { capturePolicy: 'allow', checked },
  });
}

export function radioEvent(sequence: number): RecordingEvent {
  return RecordingEventSchema.parse({
    ...baseEvent(sequence, `plan-${sequence}`, {
      inputType: 'radio',
      role: 'radio',
      name: 'servicePlan',
      labelText: 'Premium plan',
      accessibleName: 'Premium plan',
    }),
    eventType: 'radio',
    payload: {
      capturePolicy: 'allow',
      checked: true,
      value: 'premium',
      truncated: false,
    },
  });
}

export function artifact(events: readonly RecordingEvent[]): RecordingArtifact {
  return RecordingArtifactSchema.parse({
    schemaVersion: 1,
    clientSessionId,
    targetOrigin: origin,
    startedAt: '2026-07-29T10:00:00.000Z',
    stoppedAt: '2026-07-29T10:05:00.000Z',
    eventCount: events.length,
    lastSequence: events.at(-1)?.sequence ?? 0,
    events,
    privacySummary: createRecordingPrivacySummary([...events]),
  });
}

export const conversionOptions = {
  schemaVersion: 1,
  workflowId: 'workflow-session-10',
  workflowName: 'Recorded customer setup',
  description: 'Deterministically converted recording.',
} as const;
