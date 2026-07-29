import { describe, expect, it } from 'vitest';

import {
  RecordingEventCandidateSchema,
  RecordingEventSchema,
} from '../src/index.js';
import { loadValidRecordingArtifact } from './fixture.js';

describe('RecordingEventSchema', () => {
  it('accepts the current sanitized version 3 event JSON', () => {
    const artifact = loadValidRecordingArtifact();

    for (const event of artifact.events) {
      expect(RecordingEventSchema.parse(event)).toEqual(event);
    }
  });

  it('accepts every supported version 3 event payload', () => {
    const base = loadValidRecordingArtifact().events[0];
    expect(base).toBeDefined();
    if (base === undefined) return;

    const variants = [
      {
        eventType: 'select',
        payload: {
          capturePolicy: 'allow',
          value: 'option-a',
          label: 'Option A',
          truncated: false,
        },
      },
      {
        eventType: 'checkbox',
        payload: {
          capturePolicy: 'allow',
          checked: true,
        },
      },
      {
        eventType: 'radio',
        payload: {
          capturePolicy: 'allow',
          checked: true,
          value: 'option-a',
          truncated: false,
        },
      },
    ] as const;

    for (const variant of variants) {
      expect(
        RecordingEventSchema.safeParse({
          ...base,
          ...variant,
        }).success,
      ).toBe(true);
    }
  });

  it('accepts a bounded allowed text value for general metadata', () => {
    const base = loadValidRecordingArtifact().events[1];
    expect(base).toBeDefined();
    if (base === undefined) return;

    const event = {
      ...base,
      target: {
        ...base.target,
        inputType: 'text',
        name: 'note',
        labelText: 'Ordinary note',
        accessibleName: 'Ordinary note',
      },
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
        value: 'safe fixture note',
        truncated: false,
      },
    };

    expect(RecordingEventSchema.safeParse(event).success).toBe(true);
  });

  it('accepts an explicitly allowed personal value only with a personal decision', () => {
    const event = structuredClone(loadValidRecordingArtifact().events[1]);
    expect(event?.eventType).toBe('text-input');
    if (event?.eventType !== 'text-input') return;

    event.privacyDecision = {
      schemaVersion: 1,
      sensitivity: 'personal',
      policy: 'allow',
      confidence: 'high',
      matchedRules: ['PERSONAL_INPUT_TYPE'],
      reasons: ['Deterministic personal metadata rules matched.'],
    };
    event.payload = {
      capturePolicy: 'allow',
      value: 'allowed.person@example.test',
      truncated: false,
    };

    expect(RecordingEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects a forged general decision for password metadata', () => {
    const event = structuredClone(loadValidRecordingArtifact().events[2]);
    expect(event?.eventType).toBe('text-input');
    if (event?.eventType !== 'text-input') return;

    event.privacyDecision = {
      schemaVersion: 1,
      sensitivity: 'general',
      policy: 'allow',
      confidence: 'medium',
      matchedRules: ['GENERAL_NO_SENSITIVE_SIGNAL'],
      reasons: ['No supported sensitive metadata rule matched.'],
    };
    event.payload = {
      capturePolicy: 'allow',
      value: 'arbitrary credential text',
      truncated: false,
    };

    expect(RecordingEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects a personal literal disguised as a general allowed value', () => {
    const event = structuredClone(loadValidRecordingArtifact().events[1]);
    expect(event?.eventType).toBe('text-input');
    if (event?.eventType !== 'text-input') return;

    event.target = {
      ...event.target,
      inputType: 'text',
      name: 'note',
      labelText: 'Ordinary note',
      accessibleName: 'Ordinary note',
    };
    event.privacyDecision = {
      schemaVersion: 1,
      sensitivity: 'general',
      policy: 'allow',
      confidence: 'medium',
      matchedRules: ['GENERAL_NO_SENSITIVE_SIGNAL'],
      reasons: ['No supported sensitive metadata rule matched.'],
    };
    event.payload = {
      capturePolicy: 'allow',
      value: 'disguised.person@example.test',
      truncated: false,
    };

    expect(RecordingEventSchema.safeParse(event).success).toBe(false);
  });

  it.each(['123456', '4111111111111111', 'token=fixture-token-12345678'])(
    'rejects a hard-sensitive allowed payload literal',
    (value) => {
      const event = structuredClone(loadValidRecordingArtifact().events[1]);
      expect(event?.eventType).toBe('text-input');
      if (event?.eventType !== 'text-input') return;

      event.target = {
        ...event.target,
        inputType: 'text',
        name: 'note',
        labelText: 'Ordinary note',
        accessibleName: 'Ordinary note',
      };
      event.privacyDecision = {
        schemaVersion: 1,
        sensitivity: 'general',
        policy: 'allow',
        confidence: 'medium',
        matchedRules: ['GENERAL_NO_SENSITIVE_SIGNAL'],
        reasons: ['No supported sensitive metadata rule matched.'],
      };
      event.payload = {
        capturePolicy: 'allow',
        value,
        truncated: false,
      };

      expect(RecordingEventSchema.safeParse(event).success).toBe(false);
    },
  );

  it('accepts the shared candidate shape without authoritative envelope fields', () => {
    const event = loadValidRecordingArtifact().events[0];
    expect(event).toBeDefined();
    if (event === undefined) return;

    const candidate: Record<string, unknown> = structuredClone(event);
    for (const key of [
      'eventId',
      'sessionId',
      'sequence',
      'tabId',
      'origin',
      'recordedAt',
    ]) {
      delete candidate[key];
    }

    expect(RecordingEventCandidateSchema.parse(candidate)).toEqual(candidate);
  });

  it('rejects a blocked privacy decision with an allowed payload', () => {
    const event = structuredClone(loadValidRecordingArtifact().events[2]);
    expect(event?.eventType).toBe('text-input');
    if (event?.eventType !== 'text-input') return;

    event.payload = {
      capturePolicy: 'allow',
      value: 'not-retained',
      truncated: false,
    };

    expect(RecordingEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects a value property added to a blocked payload', () => {
    const event = structuredClone(loadValidRecordingArtifact().events[2]);
    expect(event?.eventType).toBe('text-input');
    if (event?.eventType !== 'text-input') return;

    const unsafeEvent = {
      ...event,
      payload: {
        ...event.payload,
        value: 'fake-password-value',
      },
    };

    expect(RecordingEventSchema.safeParse(unsafeEvent).success).toBe(false);
  });

  it('rejects sensitive literals in target metadata', () => {
    const event = structuredClone(loadValidRecordingArtifact().events[0]);
    expect(event).toBeDefined();
    if (event === undefined) return;

    event.target.textPreview = 'token=fixture-token-12345678';

    expect(RecordingEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects sensitive locator identity', () => {
    const event = structuredClone(loadValidRecordingArtifact().events[0]);
    expect(event).toBeDefined();
    if (event === undefined) return;
    if (event.locatorBundle.primary.locator.kind !== 'testId') return;

    event.locatorBundle.primary.locator.value = 'contact-fixture@example.test';

    expect(RecordingEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects unexpected event properties', () => {
    const event = {
      ...loadValidRecordingArtifact().events[0],
      rawValue: 'not-accepted',
    };

    expect(RecordingEventSchema.safeParse(event).success).toBe(false);
  });
});
