import { describe, expect, it } from 'vitest';

import {
  MAX_INPUT_VALUE_LENGTH,
  LegacyRecordingTimelineSchema,
  RecordingEventCandidateSchema,
  RecordingEventSchema,
  RecordingTimelineSchema,
  type RecordingEventCandidate,
  type RecordingTargetSnapshot,
} from '../src/recorder/event-contracts.js';
import { locatorBundleFixture } from './locator-fixture.js';

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
    schemaVersion: 2,
    eventType: 'click',
    occurredAt,
    target,
    locatorBundle: locatorBundleFixture,
    payload: { activation: 'primary' },
  },
  {
    schemaVersion: 2,
    eventType: 'text-input',
    occurredAt,
    target: { ...target, tagName: 'input', inputType: 'text' },
    locatorBundle: locatorBundleFixture,
    payload: {
      masked: false,
      maskedReason: null,
      value: 'TaskTwin',
      truncated: false,
    },
  },
  {
    schemaVersion: 2,
    eventType: 'select',
    occurredAt,
    target: { ...target, tagName: 'select' },
    locatorBundle: locatorBundleFixture,
    payload: {
      value: 'second',
      label: 'Second option',
      truncated: false,
    },
  },
  {
    schemaVersion: 2,
    eventType: 'checkbox',
    occurredAt,
    target: { ...target, tagName: 'input', inputType: 'checkbox' },
    locatorBundle: locatorBundleFixture,
    payload: { checked: true },
  },
  {
    schemaVersion: 2,
    eventType: 'radio',
    occurredAt,
    target: { ...target, tagName: 'input', inputType: 'radio' },
    locatorBundle: locatorBundleFixture,
    payload: { checked: true, value: 'alpha', truncated: false },
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

  it('requires masked values to be null', () => {
    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[1],
        payload: {
          masked: true,
          maskedReason: 'password',
          value: 'must-not-persist',
          truncated: false,
        },
      }).success,
    ).toBe(false);

    expect(
      RecordingEventCandidateSchema.safeParse({
        ...candidates[1],
        payload: {
          masked: true,
          maskedReason: 'one-time-code',
          value: null,
          truncated: false,
        },
      }).success,
    ).toBe(true);
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
      schemaVersion: 2,
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
});
