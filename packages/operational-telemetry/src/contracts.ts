import { z } from 'zod';

import {
  COMPONENT_HEALTH_STATES,
  METRIC_WINDOWS,
  OPERATIONAL_COMPONENT_TYPES,
  OPERATIONAL_TELEMETRY_SCHEMA_VERSION,
} from './constants.js';

const IsoTimestampSchema = z.iso.datetime({ offset: true });
const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const NullableAgeSchema = z.number().int().nonnegative().nullable();
const NullableRateSchema = z.number().min(0).max(1).nullable();

export const OperationalComponentTypeSchema = z.enum(
  OPERATIONAL_COMPONENT_TYPES,
);
export type OperationalComponentType = z.infer<
  typeof OperationalComponentTypeSchema
>;

export const ComponentHealthStateSchema = z.enum(COMPONENT_HEALTH_STATES);
export type ComponentHealthState = z.infer<typeof ComponentHealthStateSchema>;

export const MetricWindowSchema = z.enum(METRIC_WINDOWS);
export type MetricWindow = z.infer<typeof MetricWindowSchema>;

export const ComponentHeartbeatSampleSchema = z
  .object({
    componentType: OperationalComponentTypeSchema,
    startedAt: IsoTimestampSchema,
    latestHeartbeatAt: IsoTimestampSchema,
    gracefulStoppedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type ComponentHeartbeatSample = z.infer<
  typeof ComponentHeartbeatSampleSchema
>;

export const ComponentHealthSummarySchema = z
  .object({
    state: ComponentHealthStateSchema,
    lastSeenAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type ComponentHealthSummary = z.infer<
  typeof ComponentHealthSummarySchema
>;

export const MetricWindowSummarySchema = z
  .object({
    selected: MetricWindowSchema,
    startsAt: IsoTimestampSchema,
    endsAt: IsoTimestampSchema,
    bucketSeconds: z.number().int().positive(),
    bucketCount: z.number().int().positive().max(30),
  })
  .strict();
export type MetricWindowSummary = z.infer<typeof MetricWindowSummarySchema>;

export const RunnerSummarySchema = z
  .object({
    total: CountSchema,
    online: CountSchema,
    offline: CountSchema,
    revoked: CountSchema,
    busy: CountSchema,
    available: CountSchema,
    compliant: CountSchema,
    updateAvailable: CountSchema,
    updateRequired: CountSchema,
    unsupported: CountSchema,
  })
  .strict();

export const WorkflowRunSummarySchema = z
  .object({
    total: CountSchema,
    succeeded: CountSchema,
    failed: CountSchema,
    timedOut: CountSchema,
    interrupted: CountSchema,
    cancelled: CountSchema,
    currentlyActive: CountSchema,
    currentlyWaitingForApproval: CountSchema,
    currentlyWaitingForRepair: CountSchema,
    successRate: NullableRateSchema,
    failureRate: NullableRateSchema,
    averageTerminalDurationMs: NullableAgeSchema,
  })
  .strict();

export const ApprovalSummarySchema = z
  .object({
    pending: CountSchema,
    approved: CountSchema,
    rejected: CountSchema,
    expired: CountSchema,
    oldestPendingAgeSeconds: NullableAgeSchema,
  })
  .strict();

export const RepairSummarySchema = z
  .object({
    pending: CountSchema,
    retryApproved: CountSchema,
    aborted: CountSchema,
    expired: CountSchema,
    oldestPendingAgeSeconds: NullableAgeSchema,
  })
  .strict();

export const ScheduleSummarySchema = z
  .object({
    active: CountSchema,
    paused: CountSchema,
    autoPaused: CountSchema,
    completed: CountSchema,
    occurrences: CountSchema,
    succeededOccurrences: CountSchema,
    skippedOccurrences: CountSchema,
    timedOutOccurrences: CountSchema,
    startWindowExpiredOccurrences: CountSchema,
  })
  .strict();

export const NotificationSummarySchema = z
  .object({
    pendingOutbox: CountSchema,
    processingOutbox: CountSchema,
    delivered: CountSchema,
    deadLetter: CountSchema,
    activeAlerts: CountSchema,
    criticalActiveAlerts: CountSchema,
  })
  .strict();

export const AuditIntegritySummarySchema = z
  .object({
    chainHeadSequence: CountSchema,
    lastVerifiedAt: IsoTimestampSchema.nullable(),
    status: z.enum(['valid', 'invalid', 'not_verified']),
  })
  .strict();

export const RunOutcomeBucketSchema = z
  .object({
    startsAt: IsoTimestampSchema,
    endsAt: IsoTimestampSchema,
    succeeded: CountSchema,
    failed: CountSchema,
    timedOut: CountSchema,
    interrupted: CountSchema,
    cancelled: CountSchema,
  })
  .strict();
export type RunOutcomeBucket = z.infer<typeof RunOutcomeBucketSchema>;

export const WorkspaceOperationsSnapshotSchema = z
  .object({
    schemaVersion: z.literal(OPERATIONAL_TELEMETRY_SCHEMA_VERSION),
    generatedAt: IsoTimestampSchema,
    window: MetricWindowSummarySchema,
    components: z
      .object({
        controlPlaneApi: ComponentHealthSummarySchema,
        scheduler: ComponentHealthSummarySchema,
        notificationWorker: ComponentHealthSummarySchema,
      })
      .strict(),
    runners: RunnerSummarySchema,
    runs: WorkflowRunSummarySchema,
    approvals: ApprovalSummarySchema,
    repairs: RepairSummarySchema,
    schedules: ScheduleSummarySchema,
    notifications: NotificationSummarySchema,
    auditIntegrity: AuditIntegritySummarySchema,
    runOutcomeTimeline: z.array(RunOutcomeBucketSchema).max(30),
  })
  .strict();

export type WorkspaceOperationsSnapshot = z.infer<
  typeof WorkspaceOperationsSnapshotSchema
>;
