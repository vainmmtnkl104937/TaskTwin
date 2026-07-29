import { describe, expect, it } from 'vitest';

import {
  RecorderCommandSchema,
  RecordingSessionStateSchema,
} from '../src/recorder/contracts.js';

describe('recorder message contracts', () => {
  it.each([
    'recorder/start',
    'recorder/pause',
    'recorder/resume',
    'recorder/stop',
    'recorder/reset',
    'recorder/get-state',
  ] as const)('accepts the %s command', (type) => {
    expect(RecorderCommandSchema.safeParse({ type }).success).toBe(true);
  });

  it('rejects unknown commands and unexpected properties', () => {
    expect(
      RecorderCommandSchema.safeParse({ type: 'recorder/delete' }).success,
    ).toBe(false);
    expect(
      RecorderCommandSchema.safeParse({
        type: 'recorder/start',
        tabId: 42,
      }).success,
    ).toBe(false);
  });

  it('rejects malformed and internally inconsistent state', () => {
    const malformed = {
      schemaVersion: 1,
      status: 'recording',
      sessionId: null,
      activeTabId: null,
      activeWindowId: null,
      targetOrigin: 'https://example.com/private/path?token=value',
      startedAt: null,
      pausedAt: null,
      lastUpdatedAt: 'not-a-timestamp',
      error: null,
    };

    expect(RecordingSessionStateSchema.safeParse(malformed).success).toBe(
      false,
    );
  });

  it('accepts only an origin rather than a complete page URL', () => {
    const validState = {
      schemaVersion: 1,
      status: 'recording',
      sessionId: '57a1a7d4-5ada-4bc8-ac17-10c84746a567',
      activeTabId: 42,
      activeWindowId: 7,
      targetOrigin: 'https://example.com',
      startedAt: '2026-07-29T10:00:00.000Z',
      pausedAt: null,
      lastUpdatedAt: '2026-07-29T10:00:00.000Z',
      error: null,
    };

    expect(RecordingSessionStateSchema.safeParse(validState).success).toBe(
      true,
    );
    expect(
      RecordingSessionStateSchema.safeParse({
        ...validState,
        targetOrigin: 'https://example.com/account',
      }).success,
    ).toBe(false);
  });
});
