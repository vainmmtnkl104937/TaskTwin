import type {
  RecorderErrorCode,
  RecorderStateChangedNotification,
  RecordingSessionState,
} from './contracts.js';
import type {
  FlushPendingNotification,
  RecordingTimeline,
} from './event-contracts.js';

export interface ActiveTab {
  id: number;
  windowId: number;
  url?: string;
}

export interface RecordingStateStore {
  load(): Promise<unknown | undefined>;
  save(state: RecordingSessionState): Promise<void>;
}

export interface RecordingTimelineStore {
  load(): Promise<unknown | undefined>;
  save(timeline: RecordingTimeline): Promise<void>;
}

export interface ActiveTabProvider {
  getActiveTab(): Promise<ActiveTab | null>;
}

export interface ContentScriptCoordinator {
  prepare(tabId: number): Promise<void>;
  notify(
    tabId: number,
    notification: RecorderStateChangedNotification,
  ): Promise<unknown>;
  flushPending(
    tabId: number,
    notification: FlushPendingNotification,
  ): Promise<unknown>;
}

export interface RecorderClock {
  now(): string;
}

export interface RecorderIdGenerator {
  createSessionId(): string;
}

export interface EventIdGenerator {
  createEventId(): string;
}

export class RecorderIntegrationError extends Error {
  constructor(readonly code: RecorderErrorCode) {
    super(code);
    this.name = 'RecorderIntegrationError';
  }
}
