import { describe, expect, it } from 'vitest';

import {
  MAX_INPUT_VALUE_LENGTH,
  LegacyRecordingTimelineSchema,
  LegacyV2RecordingTimelineSchema,
  RecordingEventCandidateSchema,
  RecordingEventSchema,
  RecordingTimelineSchema,
  type RecordingEventCandidate,
  type RecordingTargetSnapshot,
} from '../src/recorder/event-contracts.js';
import { locatorBundleFixture } from './locator-fixture.js';
import {
  authenticationBlockDecision,
  generalPrivacyDecision,
  personalMaskDecision,
  publicPrivacyDecision,
} from './privacy-fixture.js';

const occurredAt = '2026-07-29T10:00:00.000Z';
const sessionId = '57a1a7d4-5ada-4bc8-ac17-10c84746a567';
const eventId = 'a5ebf13e-49e5-476f-98a5-9c376cf013d4';

const target: RecordingTargetSnapshot = {
  tagName: 'button',
  inputType: null,
  role: null,
  id: 'save-button',
  name: null,
  labelText: null,
  accessibleName: 'Save',
  placeholder: null,
  textPreview: 'Save',
  testIdCandidates: [{ attribute: 'data-testid', value: 'save-button' }],
};

const candidates = [
  {
    schemaVersion: 3,
    eventType: 'click',
    occurredAt,
    target,
    locatorBundle: locatorBundleFixture,
    privacyDecision: publicPrivacyDecision,
    payload: { activation: 'primary' },
  },
  {
    schemaVersion: 3,
    eventType: 'text-input',
    occurredAt,
    target: { ...target, tagName: 'input', inputType: 'text' },
    locatorBundle: locatorBundleFixture,
    privacyDecision: generalPrivacyDecision,
    payload: {
      capturePolicy: 'allow',
      value: 'TaskTwin',
      truncated: false,
    },
  },
  {
    schemaVersion: 3,
    eventType: 'select',
    occurredAt,
    target: { ...target, tagName: 'select' },
    locatorBundle: locatorBundleFixture,
    privacyDecision: generalPrivacyDecision,
    payload: {
      capturePolicy: 'allow',
      value: 'second',
      label: 'Second option',
      truncated: false,
    },
  },
  {
    schemaVersion: 3,
    eventType: 'checkbox',
    occurredAt,
    target: { ...target, tagName: 'input', inputType: 'checkbox' },
    locatorBundle: locatorBundleFixture,
    privacyDecision: generalPrivacyDecision,
    payload: { capturePolicy: 'allow', checked: true },
  },
  {
    schemaVersion: 3,
    eventType: 'radio',
    occurredAt,
    target: { ...target, tagName: 'input', inputType: 'radio' },
    locatorBundle: locatorBundleFixture,
    privacyDecision: generalPrivacyDecision,
    payload: {
      capturePolicy: 'allow',
      checked: true,
      value: 'alpha',
      truncated: false,
    },
  },
] satisfies RecordingEventCandidate[];

describe('recording event contracts', () => {
  it.each(candidates)('accepts a valid $eventType candidate', (candidate) => {
    expect(RecordingEventCandidateSchema.safeParse(candidate).success).toBe(
      true,
    );
  });

  it('rejects malformed candidates and unexpected properties', () => {
    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[0],
        eventType: 'scroll',
      }).success,
    ).toBe(false);
    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[0],
        locatorBundle: {
          ...locatorBundleFixture,
          primary: {
            ...locatorBundleFixture.primary,
            matchCount: 2,
            unique: false,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[0],
        sequence: 1,
      }).success,
    ).toBe(false);
  });

  it('rejects sensitive literals in target snapshots and locator identity', () => {
    const sensitiveText = ['fixture.person', 'example.test'].join('@');
    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[0],
        target: { ...target, textPreview: sensitiveText },
      }).success,
    ).toBe(false);
    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[0],
        locatorBundle: {
          ...locatorBundleFixture,
          primary: {
            ...locatorBundleFixture.primary,
            source: 'text',
            locator: {
              kind: 'text',
              value: sensitiveText,
              exact: true,
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('bounds captured values', () => {
    const textCandidate = candidates[1];
    if (textCandidate === undefined) {
      throw new Error('Expected a text-input candidate');
    }

    expect(
      RecordingEventCandidateSchema.safeParse({
        ...textCandidate,
        payload: {
          ...textCandidate.payload,
          value: 'x'.repeat(MAX_INPUT_VALUE_LENGTH + 1),
        },
      }).success,
    ).toBe(false);
  });

  it('requires masked values to be null and blocked values to be absent', () => {
    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[1],
        privacyDecision: personalMaskDecision,
        payload: {
          capturePolicy: 'mask',
          value: 'must-not-persist',
          truncated: false,
        },
      }).success,
    ).toBe(false);

    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[1],
        privacyDecision: personalMaskDecision,
        payload: {
          capturePolicy: 'mask',
          value: null,
          truncated: false,
        },
      }).success,
    ).toBe(true);

    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[1],
        privacyDecision: authenticationBlockDecision,
        payload: { capturePolicy: 'block' },
      }).success,
    ).toBe(true);
    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[1],
        privacyDecision: authenticationBlockDecision,
        payload: {
          capturePolicy: 'block',
          value: 'must-not-persist',
        },
      }).success,
    ).toBe(false);
  });

  it('validates ordered, session-scoped timelines', () => {
    const event = RecordingEventSchema.parse({
      ...candidates[0],
      eventId,
      sessionId,
      sequence: 1,
      tabId: 42,
      origin: 'https://example.com',
      recordedAt: occurredAt,
    });
    const timeline = {
      schemaVersion: 3,
      sessionId,
      nextSequence: 2,
      events: [event],
    };

    expect(RecordingTimelineSchema.safeParse(timeline).success).toBe(true);
    expect(
      RecordingTimelineSchema.safeParse({
        ...timeline,
        nextSequence: 3,
      }).success,
    ).toBe(false);
    expect(
      RecordingTimelineSchema.safeParse({
        ...timeline,
        events: [{ ...event, sequence: 2 }],
      }).success,
    ).toBe(false);
  });

  it('reads the previous timeline schema explicitly without accepting it for new writes', () => {
    const legacyTimeline = {
      schemaVersion: 1,
      sessionId,
      nextSequence: 2,
      events: [
        {
          schemaVersion: 1,
          eventType: 'click',
          occurredAt,
          target,
          payload: { activation: 'primary' },
          eventId,
          sessionId,
          sequence: 1,
          tabId: 42,
          origin: 'https://example.com',
          recordedAt: occurredAt,
        },
      ],
    };

    expect(
      LegacyRecordingTimelineSchema.safeParse(legacyTimeline).success,
    ).toBe(true);
    expect(RecordingTimelineSchema.safeParse(legacyTimeline).success).toBe(
      false,
    );
  });

  it('reads locator timeline v2 explicitly without accepting it for new writes', () => {
    const legacyV2Timeline = {
      schemaVersion: 2,
      sessionId,
      nextSequence: 2,
      events: [
        {
          schemaVersion: 2,
          eventType: 'click',
          occurredAt,
          target,
          locatorBundle: locatorBundleFixture,
          payload: { activation: 'primary' },
          eventId,
          sessionId,
          sequence: 1,
          tabId: 42,
          origin: 'https://example.com',
          recordedAt: occurredAt,
        },
      ],
    };

    expect(
      LegacyV2RecordingTimelineSchema.safeParse(legacyV2Timeline).success,
    ).toBe(true);
    expect(RecordingTimelineSchema.safeParse(legacyV2Timeline).success).toBe(
      false,
    );
  });
});
