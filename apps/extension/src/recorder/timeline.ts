import {
  MAX_RECORDING_EVENTS,
  RecordingEventSchema,
  RecordingTimelineSchema,
  type RecordingEvent,
  type RecordingEventCandidate,
  type RecordingTimeline,
  type RecordingTimelineSummary,
} from './event-contracts.js';

export function createRecordingTimeline(sessionId: string): RecordingTimeline {
  return RecordingTimelineSchema.parse({
    schemaVersion: 1,
    sessionId,
    nextSequence: 1,
    events: [],
  });
}

export function summarizeRecordingTimeline(
  timeline: RecordingTimeline | undefined,
): RecordingTimelineSummary {
  const latestEvent = timeline?.events.at(-1);
  return {
    eventCount: timeline?.events.length ?? 0,
    latestEventType: latestEvent?.eventType ?? null,
  };
}

export type AppendRecordingEventResult =
  | {
      success: true;
      event: RecordingEvent;
      timeline: RecordingTimeline;
    }
  | { success: false; reason: 'limit-reached' };

export function appendRecordingEvent(
  timeline: RecordingTimeline,
  candidate: RecordingEventCandidate,
  envelope: {
    eventId: string;
    sessionId: string;
    sequence: number;
    tabId: number;
    origin: string;
    recordedAt: string;
  },
): AppendRecordingEventResult {
  if (timeline.events.length >= MAX_RECORDING_EVENTS) {
    return { success: false, reason: 'limit-reached' };
  }

  const event = RecordingEventSchema.parse({
    ...candidate,
    ...envelope,
  });
  const nextTimeline = RecordingTimelineSchema.parse({
    ...timeline,
    nextSequence: event.sequence + 1,
    events: [...timeline.events, event],
  });

  return {
    success: true,
    event,
    timeline: nextTimeline,
  };
}
