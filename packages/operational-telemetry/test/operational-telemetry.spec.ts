import { describe, expect, it } from 'vitest';

import {
  WorkspaceOperationsSnapshotSchema,
  assertTelemetrySafe,
  calculateRate,
  createEmptyRunOutcomeBuckets,
  deriveComponentHealth,
  parseMetricWindow,
  resolveMetricWindow,
  summarizeComponentHealth,
} from '../src/index.js';

const now = new Date('2026-08-08T12:00:00.000Z');

describe('operational telemetry', () => {
  it('applies exact freshness boundaries', () => {
    expect(deriveComponentHealth(new Date(now.getTime() - 90_000), now)).toBe(
      'healthy',
    );
    expect(deriveComponentHealth(new Date(now.getTime() - 90_001), now)).toBe(
      'degraded',
    );
    expect(deriveComponentHealth(new Date(now.getTime() - 180_000), now)).toBe(
      'degraded',
    );
    expect(deriveComponentHealth(new Date(now.getTime() - 180_001), now)).toBe(
      'unavailable',
    );
    expect(deriveComponentHealth(null, now)).toBe('unknown');
  });

  it('uses one fresh instance and ignores stopped instances', () => {
    const summary = summarizeComponentHealth({
      componentType: 'scheduler',
      now,
      samples: [
        {
          componentType: 'scheduler',
          startedAt: '2026-08-08T10:00:00.000Z',
          latestHeartbeatAt: '2026-08-08T11:55:00.000Z',
          gracefulStoppedAt: null,
        },
        {
          componentType: 'scheduler',
          startedAt: '2026-08-08T11:59:00.000Z',
          latestHeartbeatAt: '2026-08-08T11:59:30.000Z',
          gracefulStoppedAt: null,
        },
        {
          componentType: 'scheduler',
          startedAt: '2026-08-08T11:59:00.000Z',
          latestHeartbeatAt: '2026-08-08T11:59:50.000Z',
          gracefulStoppedAt: '2026-08-08T11:59:55.000Z',
        },
      ],
    });
    expect(summary.state).toBe('healthy');
    expect(summary.lastSeenAt).toBe('2026-08-08T11:59:50.000Z');
  });

  it('supports only fixed deterministic windows and buckets', () => {
    for (const selected of ['1h', '24h', '7d', '30d'] as const) {
      const window = resolveMetricWindow(parseMetricWindow(selected), now);
      expect(createEmptyRunOutcomeBuckets(window)).toHaveLength(
        window.bucketCount,
      );
    }
    expect(() => parseMetricWindow('2h')).toThrowError(
      'TELEMETRY_WINDOW_UNSUPPORTED',
    );
    const oneHour = resolveMetricWindow('1h', now);
    expect(oneHour.bucketSeconds).toBe(300);
    expect(oneHour.startsAt).toBe('2026-08-08T11:00:00.000Z');
  });

  it('returns null for a zero denominator and calculates normal rates', () => {
    expect(calculateRate(0, 0)).toBeNull();
    expect(calculateRate(3, 4)).toBe(0.75);
  });

  it('strictly validates safe snapshots', () => {
    const window = resolveMetricWindow('1h', now);
    const countSet = {
      total: 0,
      online: 0,
      offline: 0,
      revoked: 0,
      busy: 0,
      available: 0,
      compliant: 0,
      updateAvailable: 0,
      updateRequired: 0,
      unsupported: 0,
    };
    const snapshot = {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      window,
      components: {
        controlPlaneApi: { state: 'healthy', lastSeenAt: now.toISOString() },
        scheduler: { state: 'unknown', lastSeenAt: null },
        notificationWorker: { state: 'unknown', lastSeenAt: null },
      },
      runners: countSet,
      runs: {
        total: 0,
        succeeded: 0,
        failed: 0,
        timedOut: 0,
        interrupted: 0,
        cancelled: 0,
        currentlyActive: 0,
        currentlyWaitingForApproval: 0,
        currentlyWaitingForRepair: 0,
        successRate: null,
        failureRate: null,
        averageTerminalDurationMs: null,
      },
      approvals: {
        pending: 0,
        approved: 0,
        rejected: 0,
        expired: 0,
        oldestPendingAgeSeconds: null,
      },
      repairs: {
        pending: 0,
        retryApproved: 0,
        aborted: 0,
        expired: 0,
        oldestPendingAgeSeconds: null,
      },
      schedules: {
        active: 0,
        paused: 0,
        autoPaused: 0,
        completed: 0,
        occurrences: 0,
        succeededOccurrences: 0,
        skippedOccurrences: 0,
        timedOutOccurrences: 0,
        startWindowExpiredOccurrences: 0,
      },
      notifications: {
        pendingOutbox: 0,
        processingOutbox: 0,
        delivered: 0,
        deadLetter: 0,
        activeAlerts: 0,
        criticalActiveAlerts: 0,
      },
      auditIntegrity: {
        chainHeadSequence: 0,
        lastVerifiedAt: null,
        status: 'not_verified',
      },
      runOutcomeTimeline: createEmptyRunOutcomeBuckets(window),
    };
    expect(WorkspaceOperationsSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      WorkspaceOperationsSnapshotSchema.safeParse({
        ...snapshot,
        runtimeInput: 'forbidden',
      }).success,
    ).toBe(false);
    expect(() =>
      assertTelemetrySafe({ secretValue: 'TELEMETRY_SECRET_28' }),
    ).toThrowError('TELEMETRY_INVALID');
    for (const prohibited of [
      { hostname: 'private-host' },
      { ip: '192.0.2.1' },
      { osUsername: 'operator' },
      { containerId: 'runtime-container' },
      { filesystemPath: 'private-path' },
      { fullUrl: 'https://sensitive.example/private' },
      { rawBrowserError: 'browser detail' },
    ]) {
      expect(() => assertTelemetrySafe(prohibited)).toThrowError(
        'TELEMETRY_INVALID',
      );
    }
  });
});
