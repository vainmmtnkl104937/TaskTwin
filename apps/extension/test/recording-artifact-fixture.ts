import {
  createRecordingPrivacySummary,
  RecordingArtifactSchema,
  RecordingEventSchema,
  type RecordingArtifact,
  type RecordingEvent,
} from '@tasktwin/recording-schema';

import { locatorBundleFixture } from './locator-fixture.js';
import {
  authenticationBlockDecision,
  publicPrivacyDecision,
} from './privacy-fixture.js';

export const recordingTimestamp = '2026-07-29T10:00:00.000Z';
export const recordingSessionId = '57a1a7d4-5ada-4bc8-ac17-10c84746a567';

export function createRecordingEvent(
  overrides: Partial<RecordingEvent> = {},
): RecordingEvent {
  return RecordingEventSchema.parse({
    schemaVersion: 3,
    eventType: 'click',
    occurredAt: recordingTimestamp,
    target: {
      tagName: 'button',
      inputType: null,
      role: 'button',
      id: 'save-button',
      name: null,
      labelText: null,
      accessibleName: 'Save',
      placeholder: null,
      textPreview: 'Save',
      testIdCandidates: [{ attribute: 'data-testid', value: 'save-button' }],
    },
    locatorBundle: locatorBundleFixture,
    privacyDecision: publicPrivacyDecision,
    payload: { activation: 'primary' },
    eventId: 'a5ebf13e-49e5-476f-98a5-9c376cf013d4',
    sessionId: recordingSessionId,
    sequence: 1,
    tabId: 42,
    origin: 'https://example.com',
    recordedAt: recordingTimestamp,
    ...overrides,
  });
}

export function createBlockedRecordingEvent(
  blockedValue: string,
): RecordingEvent {
  void blockedValue;
  return RecordingEventSchema.parse({
    ...createRecordingEvent(),
    eventType: 'text-input',
    target: {
      ...createRecordingEvent().target,
      tagName: 'input',
      inputType: 'password',
      id: 'password-field',
      accessibleName: 'Password',
      textPreview: null,
      testIdCandidates: [{ attribute: 'data-testid', value: 'password-field' }],
    },
    privacyDecision: authenticationBlockDecision,
    payload: { capturePolicy: 'block' },
  });
}

export function createRecordingArtifact(options?: {
  clientSessionId?: string;
  events?: RecordingEvent[];
  stoppedAt?: string;
}): RecordingArtifact {
  const clientSessionId = options?.clientSessionId ?? recordingSessionId;
  const events = (options?.events ?? [createRecordingEvent()]).map(
    (event, index) =>
      RecordingEventSchema.parse({
        ...event,
        sessionId: clientSessionId,
        sequence: index + 1,
      }),
  );
  return RecordingArtifactSchema.parse({
    schemaVersion: 1,
    clientSessionId,
    targetOrigin: 'https://example.com',
    startedAt: recordingTimestamp,
    stoppedAt: options?.stoppedAt ?? recordingTimestamp,
    eventCount: events.length,
    lastSequence: events.at(-1)?.sequence ?? 0,
    events,
    privacySummary: createRecordingPrivacySummary(events),
  });
}
