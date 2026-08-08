import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@tasktwin/database';

import { OperationsQueryService } from './operations-query.service.js';

const workspaceId = '00000000-0000-4000-8000-000000000028';

describe('OperationsQueryService', () => {
  it('builds a bounded safe zero-run snapshot from Workspace-scoped queries', async () => {
    const sqlSeen: string[] = [];
    const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      sqlSeen.push(sql);
      if (sql.includes('clock_timestamp() AS "now"'))
        return [{ now: new Date('2026-08-08T12:00:00.000Z') }];
      if (sql.includes('operational_component_heartbeats')) return [];
      if (sql.includes('FROM "runner_devices"'))
        return [{ total: 0n, online: 0n, offline: 0n, revoked: 0n, busy: 0n }];
      if (
        sql.includes('FROM "workflow_runs"') &&
        sql.includes('averageDurationMs')
      )
        return [];
      if (
        sql.includes('FROM "workflow_runs"') &&
        sql.includes('GROUP BY "status"')
      )
        return [];
      if (
        sql.includes('workflow_approval_requests') &&
        sql.includes('oldestPendingAgeSeconds')
      )
        return [{ pending: 0n, oldestPendingAgeSeconds: null }];
      if (sql.includes('workflow_approval_requests')) return [];
      if (
        sql.includes('workflow_repair_requests') &&
        sql.includes('oldestPendingAgeSeconds')
      )
        return [{ pending: 0n, oldestPendingAgeSeconds: null }];
      if (sql.includes('workflow_repair_requests')) return [];
      if (
        sql.includes('FROM "workflow_schedules"') &&
        !sql.includes('occurrence')
      )
        return [];
      if (sql.includes('workflow_schedule_occurrences')) return [];
      if (sql.includes('notification_outbox_messages'))
        return [
          {
            pendingOutbox: 0n,
            processingOutbox: 0n,
            delivered: 0n,
            deadLetter: 0n,
            activeAlerts: 0n,
            criticalActiveAlerts: 0n,
          },
        ];
      if (sql.includes('workspace_audit_verification_states'))
        return [
          {
            chainHeadSequence: 0,
            valid: null,
            checkedEventCount: null,
            lastSequence: null,
            verifiedAt: null,
          },
        ];
      if (sql.includes('bucketIndex')) return [];
      throw new Error(`Unexpected safe test query: ${sql}`);
    });
    const transaction = vi.fn(
      async (
        callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
      ) => callback({ $queryRaw: queryRaw }),
    );
    const service = new OperationsQueryService({
      $transaction: transaction,
    } as unknown as PrismaClient);
    const snapshot = await service.getSnapshot({ workspaceId, window: '1h' });
    expect(snapshot.runs.successRate).toBeNull();
    expect(snapshot.runs.failureRate).toBeNull();
    expect(snapshot.runOutcomeTimeline).toHaveLength(12);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /TELEMETRY_(?:INPUT|SECRET|OUTPUT|LOCATOR)_28|https?:\/\//,
    );

    const domainQueries = sqlSeen.filter(
      (sql) =>
        !sql.includes('clock_timestamp() AS "now"') &&
        !sql.includes('operational_component_heartbeats'),
    );
    expect(domainQueries).not.toHaveLength(0);
    for (const sql of domainQueries) expect(sql).toContain('workspace');
    expect(sqlSeen.join('\n')).not.toMatch(
      /audit.*payload|workflow_versions.*definition/is,
    );
  });

  it.each([
    { valid: false, lastSequence: 7, expected: 'invalid' },
    { valid: true, lastSequence: 8, expected: 'valid' },
  ] as const)(
    'aggregates structured Workspace metrics with $expected audit state',
    async ({ valid, lastSequence, expected }) => {
      const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('clock_timestamp() AS "now"'))
          return [{ now: new Date('2026-08-08T12:00:00.000Z') }];
        if (sql.includes('operational_component_heartbeats'))
          return [
            {
              componentType: 'control_plane_api',
              startedAt: new Date('2026-08-08T10:00:00.000Z'),
              latestHeartbeatAt: new Date('2026-08-08T11:59:30.000Z'),
              gracefulStoppedAt: null,
            },
            {
              componentType: 'scheduler',
              startedAt: new Date('2026-08-08T10:00:00.000Z'),
              latestHeartbeatAt: new Date('2026-08-08T11:58:20.000Z'),
              gracefulStoppedAt: null,
            },
            {
              componentType: 'notification_worker',
              startedAt: new Date('2026-08-08T10:00:00.000Z'),
              latestHeartbeatAt: new Date('2026-08-08T11:56:00.000Z'),
              gracefulStoppedAt: null,
            },
          ];
        if (sql.includes('FROM "runner_devices"'))
          return [
            { total: 4n, online: 2n, offline: 1n, revoked: 1n, busy: 1n },
          ];
        if (sql.includes('averageDurationMs'))
          return [
            {
              status: 'SUCCEEDED',
              count: 2n,
              durationCount: 2n,
              averageDurationMs: 1_000,
            },
            {
              status: 'FAILED',
              count: 1n,
              durationCount: 1n,
              averageDurationMs: 2_000,
            },
            {
              status: 'TIMED_OUT',
              count: 1n,
              durationCount: 1n,
              averageDurationMs: 3_000,
            },
            {
              status: 'INTERRUPTED',
              count: 1n,
              durationCount: 1n,
              averageDurationMs: 4_000,
            },
            {
              status: 'CANCELLED',
              count: 1n,
              durationCount: 1n,
              averageDurationMs: 5_000,
            },
          ];
        if (
          sql.includes('FROM "workflow_runs"') &&
          sql.includes('GROUP BY "status"')
        )
          return [
            { status: 'RUNNING', count: 1n },
            { status: 'WAITING_FOR_APPROVAL', count: 1n },
            { status: 'WAITING_FOR_REPAIR', count: 1n },
          ];
        if (
          sql.includes('workflow_approval_requests') &&
          sql.includes('oldestPendingAgeSeconds')
        )
          return [{ pending: 2n, oldestPendingAgeSeconds: 600 }];
        if (sql.includes('workflow_approval_requests'))
          return [
            { status: 'PENDING', count: 2n },
            { status: 'APPROVED', count: 3n },
            { status: 'REJECTED', count: 1n },
            { status: 'EXPIRED', count: 1n },
          ];
        if (
          sql.includes('workflow_repair_requests') &&
          sql.includes('oldestPendingAgeSeconds')
        )
          return [{ pending: 1n, oldestPendingAgeSeconds: 300 }];
        if (sql.includes('workflow_repair_requests'))
          return [
            { status: 'PENDING', count: 1n },
            { status: 'RETRY_APPROVED', count: 2n },
            { status: 'ABORTED', count: 1n },
            { status: 'EXPIRED', count: 1n },
          ];
        if (
          sql.includes('FROM "workflow_schedules"') &&
          !sql.includes('occurrence')
        )
          return [
            { status: 'ACTIVE', count: 2n },
            { status: 'PAUSED', count: 1n },
            { status: 'AUTO_PAUSED', count: 1n },
            { status: 'COMPLETED', count: 1n },
          ];
        if (sql.includes('workflow_schedule_occurrences'))
          return [
            { status: 'SUCCEEDED', terminationCause: null, count: 2n },
            {
              status: 'SKIPPED',
              terminationCause: 'schedule_start_window_expired',
              count: 1n,
            },
            { status: 'TIMED_OUT', terminationCause: null, count: 1n },
          ];
        if (sql.includes('notification_outbox_messages'))
          return [
            {
              pendingOutbox: 2n,
              processingOutbox: 1n,
              delivered: 4n,
              deadLetter: 1n,
              activeAlerts: 3n,
              criticalActiveAlerts: 1n,
            },
          ];
        if (sql.includes('workspace_audit_verification_states'))
          return [
            {
              chainHeadSequence: 8,
              valid,
              checkedEventCount: 8,
              lastSequence,
              verifiedAt: new Date('2026-08-08T11:55:00.000Z'),
            },
          ];
        if (sql.includes('bucketIndex'))
          return [
            { bucketIndex: 0, status: 'SUCCEEDED', count: 2n },
            { bucketIndex: 0, status: 'FAILED', count: 1n },
          ];
        throw new Error(`Unexpected safe test query: ${sql}`);
      });
      const transaction = vi.fn(
        async (
          callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
        ) => callback({ $queryRaw: queryRaw }),
      );
      const service = new OperationsQueryService({
        $transaction: transaction,
      } as unknown as PrismaClient);

      const snapshot = await service.getSnapshot({
        workspaceId,
        window: '24h',
      });

      expect(snapshot.components.controlPlaneApi.state).toBe('healthy');
      expect(snapshot.components.scheduler.state).toBe('degraded');
      expect(snapshot.components.notificationWorker.state).toBe('unavailable');
      expect(snapshot.runners).toEqual({
        total: 4,
        online: 2,
        offline: 1,
        revoked: 1,
        busy: 1,
        available: 1,
      });
      expect(snapshot.runs).toMatchObject({
        total: 6,
        succeeded: 2,
        failed: 1,
        timedOut: 1,
        interrupted: 1,
        cancelled: 1,
        currentlyActive: 3,
        currentlyWaitingForApproval: 1,
        currentlyWaitingForRepair: 1,
        successRate: 0.4,
        failureRate: 0.6,
        averageTerminalDurationMs: 2_667,
      });
      expect(snapshot.approvals).toEqual({
        pending: 2,
        approved: 3,
        rejected: 1,
        expired: 1,
        oldestPendingAgeSeconds: 600,
      });
      expect(snapshot.repairs).toEqual({
        pending: 1,
        retryApproved: 2,
        aborted: 1,
        expired: 1,
        oldestPendingAgeSeconds: 300,
      });
      expect(snapshot.schedules).toMatchObject({
        active: 2,
        paused: 1,
        autoPaused: 1,
        completed: 1,
        occurrences: 4,
        succeededOccurrences: 2,
        skippedOccurrences: 1,
        timedOutOccurrences: 1,
        startWindowExpiredOccurrences: 1,
      });
      expect(snapshot.notifications).toEqual({
        pendingOutbox: 2,
        processingOutbox: 1,
        delivered: 4,
        deadLetter: 1,
        activeAlerts: 3,
        criticalActiveAlerts: 1,
      });
      expect(snapshot.auditIntegrity.status).toBe(expected);
      expect(snapshot.runOutcomeTimeline[0]).toMatchObject({
        succeeded: 2,
        failed: 1,
      });
    },
  );
});
