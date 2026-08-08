import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createEmptyRunOutcomeBuckets,
  resolveMetricWindow,
  type WorkspaceOperationsSnapshot,
} from '@tasktwin/operational-telemetry';

import { OperationsDashboard } from '@/components/operations/operations-dashboard';

const generatedAt = '2026-08-08T12:00:00.000Z';
const window = resolveMetricWindow('1h', new Date(generatedAt));
const snapshot: WorkspaceOperationsSnapshot = {
  schemaVersion: 1,
  generatedAt,
  window,
  components: {
    controlPlaneApi: { state: 'healthy', lastSeenAt: generatedAt },
    scheduler: { state: 'degraded', lastSeenAt: generatedAt },
    notificationWorker: { state: 'unavailable', lastSeenAt: generatedAt },
  },
  runners: {
    total: 4,
    online: 2,
    offline: 1,
    revoked: 1,
    busy: 1,
    available: 1,
  },
  runs: {
    total: 5,
    succeeded: 1,
    failed: 1,
    timedOut: 1,
    interrupted: 1,
    cancelled: 1,
    currentlyActive: 2,
    currentlyWaitingForApproval: 1,
    currentlyWaitingForRepair: 1,
    successRate: 0.25,
    failureRate: 0.75,
    averageTerminalDurationMs: 10_000,
  },
  approvals: {
    pending: 1,
    approved: 1,
    rejected: 0,
    expired: 0,
    oldestPendingAgeSeconds: 60,
  },
  repairs: {
    pending: 1,
    retryApproved: 0,
    aborted: 1,
    expired: 0,
    oldestPendingAgeSeconds: 120,
  },
  schedules: {
    active: 1,
    paused: 1,
    autoPaused: 1,
    completed: 1,
    occurrences: 3,
    succeededOccurrences: 1,
    skippedOccurrences: 1,
    timedOutOccurrences: 1,
    startWindowExpiredOccurrences: 1,
  },
  notifications: {
    pendingOutbox: 1,
    processingOutbox: 1,
    delivered: 1,
    deadLetter: 1,
    activeAlerts: 2,
    criticalActiveAlerts: 1,
  },
  auditIntegrity: {
    chainHeadSequence: 8,
    lastVerifiedAt: null,
    status: 'not_verified',
  },
  runOutcomeTimeline: createEmptyRunOutcomeBuckets(window),
};

describe('OperationsDashboard', () => {
  it('renders health, summaries, fixed windows, timeline and typed internal links', () => {
    const markup = renderToStaticMarkup(
      <OperationsDashboard
        workspaceId="00000000-0000-4000-8000-000000000028"
        snapshot={snapshot}
      />,
    );
    expect(markup).toContain('Control Plane API');
    expect(markup).toContain('Runner');
    expect(markup).toContain('Run-outcome timeline');
    expect(markup).toContain('Audit integrity');
    expect(markup).toContain('window=30d');
    expect(markup).toContain('/operations?window=1h');
    expect(markup).toContain('/notifications');
  });

  it('never renders runtime or browser fixture values', () => {
    const markup = renderToStaticMarkup(
      <OperationsDashboard
        workspaceId="00000000-0000-4000-8000-000000000028"
        snapshot={snapshot}
      />,
    );
    expect(markup).not.toMatch(
      /TELEMETRY_INPUT_SECRET_28|TELEMETRY_SECRET_28|TELEMETRY_OUTPUT_28|TELEMETRY_LOCATOR_28|https?:\/\//,
    );
    expect(markup).not.toContain('dangerouslySetInnerHTML');
  });
});
