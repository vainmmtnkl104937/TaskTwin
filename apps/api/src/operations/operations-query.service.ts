import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@tasktwin/database';
import {
  calculateRate,
  createEmptyRunOutcomeBuckets,
  resolveMetricWindow,
  summarizeComponentHealth,
  validateWorkspaceOperationsSnapshot,
  type ComponentHeartbeatSample,
  type MetricWindow,
  type WorkspaceOperationsSnapshot,
} from '@tasktwin/operational-telemetry';
import { RUNNER_OFFLINE_AFTER_SECONDS } from '@tasktwin/runner-protocol';

import { DATABASE_CLIENT } from '../database/database.constants.js';

type TransactionClient = Prisma.TransactionClient;
type Numeric = bigint | number;

interface StatusCountRow {
  status: string;
  count: Numeric;
}
interface RunAggregateRow {
  status: string;
  count: Numeric;
  durationCount: Numeric;
  averageDurationMs: number | null;
}
interface ActiveRunRow {
  status: string;
  count: Numeric;
}
interface RunnerRow {
  total: Numeric;
  online: Numeric;
  offline: Numeric;
  revoked: Numeric;
  busy: Numeric;
}
interface PendingSummaryRow {
  pending: Numeric;
  oldestPendingAgeSeconds: number | null;
}
interface OccurrenceRow {
  status: string;
  terminationCause: string | null;
  count: Numeric;
}
interface NotificationRow {
  pendingOutbox: Numeric;
  processingOutbox: Numeric;
  delivered: Numeric;
  deadLetter: Numeric;
  activeAlerts: Numeric;
  criticalActiveAlerts: Numeric;
}
interface HeartbeatRow {
  componentType: 'control_plane_api' | 'scheduler' | 'notification_worker';
  startedAt: Date;
  latestHeartbeatAt: Date;
  gracefulStoppedAt: Date | null;
}
interface AuditRow {
  chainHeadSequence: number;
  valid: boolean | null;
  checkedEventCount: number | null;
  lastSequence: number | null;
  verifiedAt: Date | null;
}
interface TimelineRow {
  bucketIndex: number;
  status: string;
  count: Numeric;
}

const count = (value: Numeric | undefined): number => Number(value ?? 0);
const byStatus = (rows: readonly StatusCountRow[], status: string): number =>
  count(rows.find((row) => row.status === status)?.count);

@Injectable()
export class OperationsQueryService {
  constructor(@Inject(DATABASE_CLIENT) private readonly prisma: PrismaClient) {}

  async getSnapshot(input: {
    workspaceId: string;
    window: MetricWindow;
  }): Promise<WorkspaceOperationsSnapshot> {
    return this.prisma.$transaction(
      async (tx) => {
        const nowRows = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() AS "now"
        `;
        const now = nowRows[0]?.now;
        if (now === undefined) throw new Error('TELEMETRY_STORAGE_UNAVAILABLE');
        const window = resolveMetricWindow(input.window, now);
        const startsAt = new Date(window.startsAt);
        const endsAt = new Date(window.endsAt);

        const [
          components,
          runners,
          runs,
          approvals,
          repairs,
          schedules,
          notifications,
          auditIntegrity,
          timeline,
        ] = await Promise.all([
          this.componentSummary(tx, now),
          this.runnerSummary(tx, input.workspaceId, now),
          this.runSummary(tx, input.workspaceId, startsAt, endsAt),
          this.approvalSummary(tx, input.workspaceId, startsAt, endsAt, now),
          this.repairSummary(tx, input.workspaceId, startsAt, endsAt, now),
          this.scheduleSummary(tx, input.workspaceId, startsAt, endsAt),
          this.notificationSummary(tx, input.workspaceId, startsAt, endsAt),
          this.auditSummary(tx, input.workspaceId),
          this.timeline(tx, input.workspaceId, window),
        ]);

        return validateWorkspaceOperationsSnapshot({
          schemaVersion: 1,
          generatedAt: now.toISOString(),
          window,
          components,
          runners,
          runs,
          approvals,
          repairs,
          schedules,
          notifications,
          auditIntegrity,
          runOutcomeTimeline: timeline,
        });
      },
      { isolationLevel: 'RepeatableRead', timeout: 10_000 },
    );
  }

  private async componentSummary(tx: TransactionClient, now: Date) {
    const rows = await tx.$queryRaw<HeartbeatRow[]>`
      SELECT heartbeat."component_type"::text AS "componentType",
             heartbeat."started_at" AS "startedAt",
             heartbeat."latest_heartbeat_at" AS "latestHeartbeatAt",
             heartbeat."graceful_stopped_at" AS "gracefulStoppedAt"
      FROM (VALUES
        ('control_plane_api'::"operational_component_type"),
        ('scheduler'::"operational_component_type"),
        ('notification_worker'::"operational_component_type")
      ) AS component("component_type")
      CROSS JOIN LATERAL (
        (SELECT candidate.* FROM "operational_component_heartbeats" candidate
         WHERE candidate."component_type" = component."component_type"
           AND candidate."graceful_stopped_at" IS NULL
         ORDER BY candidate."latest_heartbeat_at" DESC LIMIT 1)
        UNION ALL
        (SELECT candidate.* FROM "operational_component_heartbeats" candidate
         WHERE candidate."component_type" = component."component_type"
           AND candidate."graceful_stopped_at" IS NOT NULL
         ORDER BY candidate."latest_heartbeat_at" DESC LIMIT 1)
      ) heartbeat
    `;
    const samples: ComponentHeartbeatSample[] = rows.map((row) => ({
      componentType: row.componentType,
      startedAt: row.startedAt.toISOString(),
      latestHeartbeatAt: row.latestHeartbeatAt.toISOString(),
      gracefulStoppedAt: row.gracefulStoppedAt?.toISOString() ?? null,
    }));
    return {
      controlPlaneApi: summarizeComponentHealth({
        componentType: 'control_plane_api',
        samples,
        now,
      }),
      scheduler: summarizeComponentHealth({
        componentType: 'scheduler',
        samples,
        now,
      }),
      notificationWorker: summarizeComponentHealth({
        componentType: 'notification_worker',
        samples,
        now,
      }),
    };
  }

  private async runnerSummary(
    tx: TransactionClient,
    workspaceId: string,
    now: Date,
  ) {
    const rows = await tx.$queryRaw<RunnerRow[]>`
      SELECT
        COUNT(*) AS "total",
        COUNT(*) FILTER (WHERE runner."revoked_at" IS NULL AND runner."last_seen_at" >= ${now} - (${RUNNER_OFFLINE_AFTER_SECONDS} * interval '1 second')) AS "online",
        COUNT(*) FILTER (WHERE runner."revoked_at" IS NULL AND (runner."last_seen_at" IS NULL OR runner."last_seen_at" < ${now} - (${RUNNER_OFFLINE_AFTER_SECONDS} * interval '1 second'))) AS "offline",
        COUNT(*) FILTER (WHERE runner."revoked_at" IS NOT NULL) AS "revoked",
        COUNT(*) FILTER (WHERE runner."revoked_at" IS NULL AND runner."last_seen_at" >= ${now} - (${RUNNER_OFFLINE_AFTER_SECONDS} * interval '1 second') AND EXISTS (
          SELECT 1 FROM "workflow_runs" run
          WHERE run."workspace_id" = ${workspaceId}::uuid AND run."runner_device_id" = runner."id"
            AND run."status" IN ('CLAIMED','RUNNING','WAITING_FOR_APPROVAL','WAITING_FOR_REPAIR','CANCEL_REQUESTED')
        )) AS "busy"
      FROM "runner_devices" runner
      WHERE runner."workspace_id" = ${workspaceId}::uuid
    `;
    const row = rows[0] ?? {
      total: 0,
      online: 0,
      offline: 0,
      revoked: 0,
      busy: 0,
    };
    const online = count(row.online);
    const busy = count(row.busy);
    return {
      total: count(row.total),
      online,
      offline: count(row.offline),
      revoked: count(row.revoked),
      busy,
      available: Math.max(0, online - busy),
    };
  }

  private async runSummary(
    tx: TransactionClient,
    workspaceId: string,
    startsAt: Date,
    endsAt: Date,
  ) {
    const terminal = await tx.$queryRaw<RunAggregateRow[]>`
      SELECT "status"::text AS "status", COUNT(*) AS "count",
             COUNT(*) FILTER (WHERE "started_at" IS NOT NULL) AS "durationCount",
             (AVG(EXTRACT(EPOCH FROM ("finished_at" - "started_at")) * 1000)
               FILTER (WHERE "started_at" IS NOT NULL))::double precision AS "averageDurationMs"
      FROM "workflow_runs"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "finished_at" >= ${startsAt} AND "finished_at" < ${endsAt}
        AND "status" IN ('SUCCEEDED','FAILED','TIMED_OUT','INTERRUPTED','CANCELLED')
      GROUP BY "status"
    `;
    const active = await tx.$queryRaw<ActiveRunRow[]>`
      SELECT "status"::text AS "status", COUNT(*) AS "count"
      FROM "workflow_runs"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "status" IN ('QUEUED','CLAIMED','RUNNING','WAITING_FOR_APPROVAL','WAITING_FOR_REPAIR','CANCEL_REQUESTED')
      GROUP BY "status"
    `;
    const succeeded = byStatus(terminal, 'SUCCEEDED');
    const failed = byStatus(terminal, 'FAILED');
    const timedOut = byStatus(terminal, 'TIMED_OUT');
    const interrupted = byStatus(terminal, 'INTERRUPTED');
    const cancelled = byStatus(terminal, 'CANCELLED');
    const eligible = succeeded + failed + timedOut + interrupted;
    const durationCount = terminal.reduce(
      (sum, row) => sum + count(row.durationCount),
      0,
    );
    const durationTotal = terminal.reduce(
      (sum, row) =>
        sum + (row.averageDurationMs ?? 0) * count(row.durationCount),
      0,
    );
    return {
      total: succeeded + failed + timedOut + interrupted + cancelled,
      succeeded,
      failed,
      timedOut,
      interrupted,
      cancelled,
      currentlyActive: active.reduce((sum, row) => sum + count(row.count), 0),
      currentlyWaitingForApproval: byStatus(active, 'WAITING_FOR_APPROVAL'),
      currentlyWaitingForRepair: byStatus(active, 'WAITING_FOR_REPAIR'),
      successRate: calculateRate(succeeded, eligible),
      failureRate: calculateRate(failed + timedOut + interrupted, eligible),
      averageTerminalDurationMs:
        durationCount === 0
          ? null
          : Math.max(0, Math.round(durationTotal / durationCount)),
    };
  }

  private async approvalSummary(
    tx: TransactionClient,
    workspaceId: string,
    startsAt: Date,
    endsAt: Date,
    now: Date,
  ) {
    const counts = await tx.$queryRaw<StatusCountRow[]>`
      SELECT approval."status"::text AS "status", COUNT(*) AS "count"
      FROM "workflow_approval_requests" approval
      INNER JOIN "workflow_runs" run ON run."id" = approval."workflow_run_id" AND run."workspace_id" = ${workspaceId}::uuid
      WHERE approval."status" = 'PENDING'
         OR (approval."status" IN ('APPROVED','REJECTED','EXPIRED') AND approval."resolved_at" >= ${startsAt} AND approval."resolved_at" < ${endsAt})
      GROUP BY approval."status"
    `;
    const pendingRows = await tx.$queryRaw<PendingSummaryRow[]>`
      SELECT COUNT(*) AS "pending",
             EXTRACT(EPOCH FROM (${now} - MIN(approval."requested_at")))::double precision AS "oldestPendingAgeSeconds"
      FROM "workflow_approval_requests" approval
      INNER JOIN "workflow_runs" run ON run."id" = approval."workflow_run_id" AND run."workspace_id" = ${workspaceId}::uuid
      WHERE approval."status" = 'PENDING'
    `;
    const pending = pendingRows[0];
    return {
      pending: count(pending?.pending),
      approved: byStatus(counts, 'APPROVED'),
      rejected: byStatus(counts, 'REJECTED'),
      expired: byStatus(counts, 'EXPIRED'),
      oldestPendingAgeSeconds:
        pending?.oldestPendingAgeSeconds === null ||
        pending?.oldestPendingAgeSeconds === undefined
          ? null
          : Math.max(0, Math.floor(pending.oldestPendingAgeSeconds)),
    };
  }

  private async repairSummary(
    tx: TransactionClient,
    workspaceId: string,
    startsAt: Date,
    endsAt: Date,
    now: Date,
  ) {
    const counts = await tx.$queryRaw<StatusCountRow[]>`
      SELECT "status"::text AS "status", COUNT(*) AS "count"
      FROM "workflow_repair_requests"
      WHERE "workspace_id" = ${workspaceId}::uuid AND (
        "status" = 'PENDING' OR ("status" IN ('RETRY_APPROVED','ABORTED','EXPIRED') AND "resolved_at" >= ${startsAt} AND "resolved_at" < ${endsAt})
      ) GROUP BY "status"
    `;
    const pendingRows = await tx.$queryRaw<PendingSummaryRow[]>`
      SELECT COUNT(*) AS "pending", EXTRACT(EPOCH FROM (${now} - MIN("requested_at")))::double precision AS "oldestPendingAgeSeconds"
      FROM "workflow_repair_requests"
      WHERE "workspace_id" = ${workspaceId}::uuid AND "status" = 'PENDING'
    `;
    const pending = pendingRows[0];
    return {
      pending: count(pending?.pending),
      retryApproved: byStatus(counts, 'RETRY_APPROVED'),
      aborted: byStatus(counts, 'ABORTED'),
      expired: byStatus(counts, 'EXPIRED'),
      oldestPendingAgeSeconds:
        pending?.oldestPendingAgeSeconds === null ||
        pending?.oldestPendingAgeSeconds === undefined
          ? null
          : Math.max(0, Math.floor(pending.oldestPendingAgeSeconds)),
    };
  }

  private async scheduleSummary(
    tx: TransactionClient,
    workspaceId: string,
    startsAt: Date,
    endsAt: Date,
  ) {
    const schedules = await tx.$queryRaw<StatusCountRow[]>`
      SELECT "status"::text AS "status", COUNT(*) AS "count"
      FROM "workflow_schedules" WHERE "workspace_id" = ${workspaceId}::uuid GROUP BY "status"
    `;
    const occurrences = await tx.$queryRaw<OccurrenceRow[]>`
      SELECT occurrence."status"::text AS "status", occurrence."termination_cause" AS "terminationCause", COUNT(*) AS "count"
      FROM "workflow_schedule_occurrences" occurrence
      INNER JOIN "workflow_schedules" schedule ON schedule."id" = occurrence."schedule_id" AND schedule."workspace_id" = ${workspaceId}::uuid
      WHERE occurrence."scheduled_for" >= ${startsAt} AND occurrence."scheduled_for" < ${endsAt}
      GROUP BY occurrence."status", occurrence."termination_cause"
    `;
    const occurrenceCount = (status: string) =>
      occurrences
        .filter((row) => row.status === status)
        .reduce((sum, row) => sum + count(row.count), 0);
    return {
      active: byStatus(schedules, 'ACTIVE'),
      paused: byStatus(schedules, 'PAUSED'),
      autoPaused: byStatus(schedules, 'AUTO_PAUSED'),
      completed: byStatus(schedules, 'COMPLETED'),
      occurrences: occurrences.reduce((sum, row) => sum + count(row.count), 0),
      succeededOccurrences: occurrenceCount('SUCCEEDED'),
      skippedOccurrences: occurrenceCount('SKIPPED'),
      timedOutOccurrences: occurrenceCount('TIMED_OUT'),
      startWindowExpiredOccurrences: occurrences
        .filter(
          (row) => row.terminationCause === 'schedule_start_window_expired',
        )
        .reduce((sum, row) => sum + count(row.count), 0),
    };
  }

  private async notificationSummary(
    tx: TransactionClient,
    workspaceId: string,
    startsAt: Date,
    endsAt: Date,
  ) {
    const rows = await tx.$queryRaw<NotificationRow[]>`
      SELECT
        (SELECT COUNT(*) FROM "notification_outbox_messages" WHERE "workspace_id" = ${workspaceId}::uuid AND "status" = 'PENDING') AS "pendingOutbox",
        (SELECT COUNT(*) FROM "notification_outbox_messages" WHERE "workspace_id" = ${workspaceId}::uuid AND "status" = 'PROCESSING') AS "processingOutbox",
        (SELECT COUNT(*) FROM "notification_outbox_messages" WHERE "workspace_id" = ${workspaceId}::uuid AND "status" = 'DELIVERED' AND "delivered_at" >= ${startsAt} AND "delivered_at" < ${endsAt}) AS "delivered",
        (SELECT COUNT(*) FROM "notification_outbox_messages" WHERE "workspace_id" = ${workspaceId}::uuid AND "status" = 'DEAD_LETTER') AS "deadLetter",
        (SELECT COUNT(*) FROM "operational_alerts" WHERE "workspace_id" = ${workspaceId}::uuid AND "status" = 'active') AS "activeAlerts",
        (SELECT COUNT(*) FROM "operational_alerts" WHERE "workspace_id" = ${workspaceId}::uuid AND "status" = 'active' AND "severity" = 'critical') AS "criticalActiveAlerts"
    `;
    const row = rows[0];
    return {
      pendingOutbox: count(row?.pendingOutbox),
      processingOutbox: count(row?.processingOutbox),
      delivered: count(row?.delivered),
      deadLetter: count(row?.deadLetter),
      activeAlerts: count(row?.activeAlerts),
      criticalActiveAlerts: count(row?.criticalActiveAlerts),
    };
  }

  private async auditSummary(tx: TransactionClient, workspaceId: string) {
    const rows = await tx.$queryRaw<AuditRow[]>`
      SELECT COALESCE(head."last_sequence", 0) AS "chainHeadSequence",
             state."valid", state."checked_event_count" AS "checkedEventCount",
             state."last_sequence" AS "lastSequence", state."verified_at" AS "verifiedAt"
      FROM "workspaces" workspace
      LEFT JOIN "workspace_audit_chain_heads" head ON head."workspace_id" = workspace."id"
      LEFT JOIN "workspace_audit_verification_states" state ON state."workspace_id" = workspace."id"
      WHERE workspace."id" = ${workspaceId}::uuid
    `;
    const row = rows[0] ?? {
      chainHeadSequence: 0,
      valid: null,
      checkedEventCount: null,
      lastSequence: null,
      verifiedAt: null,
    };
    const validCoversHead =
      row.valid === true &&
      ((row.chainHeadSequence === 0 && row.checkedEventCount === 0) ||
        row.lastSequence === row.chainHeadSequence);
    return {
      chainHeadSequence: row.chainHeadSequence,
      lastVerifiedAt: row.verifiedAt?.toISOString() ?? null,
      status:
        row.valid === false
          ? ('invalid' as const)
          : validCoversHead
            ? ('valid' as const)
            : ('not_verified' as const),
    };
  }

  private async timeline(
    tx: TransactionClient,
    workspaceId: string,
    window: ReturnType<typeof resolveMetricWindow>,
  ) {
    const startsAt = new Date(window.startsAt);
    const endsAt = new Date(window.endsAt);
    const rows = await tx.$queryRaw<TimelineRow[]>`
      SELECT FLOOR(EXTRACT(EPOCH FROM ("finished_at" - ${startsAt})) / ${window.bucketSeconds})::integer AS "bucketIndex",
             "status"::text AS "status", COUNT(*) AS "count"
      FROM "workflow_runs"
      WHERE "workspace_id" = ${workspaceId}::uuid AND "finished_at" >= ${startsAt} AND "finished_at" < ${endsAt}
        AND "status" IN ('SUCCEEDED','FAILED','TIMED_OUT','INTERRUPTED','CANCELLED')
      GROUP BY "bucketIndex", "status"
    `;
    const buckets = createEmptyRunOutcomeBuckets(window);
    for (const row of rows) {
      const bucket = buckets[row.bucketIndex];
      if (bucket === undefined) continue;
      const value = count(row.count);
      if (row.status === 'SUCCEEDED') bucket.succeeded = value;
      else if (row.status === 'FAILED') bucket.failed = value;
      else if (row.status === 'TIMED_OUT') bucket.timedOut = value;
      else if (row.status === 'INTERRUPTED') bucket.interrupted = value;
      else if (row.status === 'CANCELLED') bucket.cancelled = value;
    }
    return buckets;
  }
}
