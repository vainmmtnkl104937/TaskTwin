-- =============================================================================
-- Session 26: Safe Scheduled WorkflowRuns
-- =============================================================================
-- This migration introduces:
--   * WorkflowSchedule model          — immutable schedule definitions
--   * WorkflowScheduleOccurrence model — per-firing occurrence records
--   * WorkflowRun trigger fields       — manual vs scheduled origin
--   * scheduled_execution_v1 capability on RunnerDevice
--
-- Concurrency design
-- ------------------
-- The scheduler uses FOR UPDATE SKIP LOCKED on schedule selection and
-- serializable transactions wrapping occurrence + run creation so that
-- multiple scheduler instances produce exactly one winner per schedule.
--
-- The unique constraint [scheduleId, scheduledFor] on
-- WorkflowScheduleOccurrence is the defence-in-depth for occurrence idempotency.
-- =============================================================================

-- New enum values
ALTER TYPE "workflow_run_status" ADD VALUE IF NOT EXISTS 'SCHEDULED_DISPATCHED';

-- New enums
CREATE TYPE "workflow_schedule_status" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'AUTO_PAUSED',
  'COMPLETED',
  'ARCHIVED'
);

CREATE TYPE "workflow_schedule_occurrence_status" AS ENUM (
  'PENDING',
  'DISPATCHED',
  'SUCCEEDED',
  'SKIPPED',
  'TIMED_OUT',
  'CANCELLED'
);

-- =============================================================================
-- WorkflowSchedule
-- =============================================================================

CREATE TABLE "workflow_schedules" (
  "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"                UUID         NOT NULL,
  "workflow_id"                 VARCHAR(256) NOT NULL,
  "workflow_version_id"         UUID         NOT NULL,
  "runner_device_id"            UUID         NOT NULL,
  "created_by_user_id"          UUID         NOT NULL,
  "client_schedule_id"           UUID         NOT NULL,
  "name"                        VARCHAR(120) NOT NULL,
  "definition"                  JSONB        NOT NULL,
  "definition_digest"           CHAR(64)     NOT NULL,
  "workflow_digest"             CHAR(64)     NOT NULL,
  "status"                      "workflow_schedule_status" NOT NULL DEFAULT 'ACTIVE',
  "overlap_policy"              VARCHAR(16)  NOT NULL DEFAULT 'skip',
  "misfire_policy"              VARCHAR(16)  NOT NULL DEFAULT 'skip',
  "max_start_delay_seconds"     INTEGER      NOT NULL DEFAULT 300,
  "next_occurrence_at"          TIMESTAMPTZ(3),
  "last_occurrence_at"          TIMESTAMPTZ(3),
  -- Auto-pause metadata
  "auto_pause_reason"          VARCHAR(80),
  "auto_paused_at"             TIMESTAMPTZ(3),
  "auto_paused_by_occurrence_id" UUID,
  -- Completion
  "completed_at"               TIMESTAMPTZ(3),
  -- Archival
  "archived_at"                TIMESTAMPTZ(3),
  "archived_by_user_id"         UUID,
  -- Timestamps
  "created_at"                  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_schedules_pkey" PRIMARY KEY ("id")
);

-- Unique: workspace + clientScheduleId for idempotency
CREATE UNIQUE INDEX "workflow_schedules_workspace_client_sched_id_key"
  ON "workflow_schedules"("workspace_id", "client_schedule_id");

-- Due-schedule selection index (most important for scheduler performance)
CREATE INDEX "workflow_schedules_status_next_idx"
  ON "workflow_schedules"("status", "next_occurrence_at")
  WHERE "status" = 'ACTIVE';

-- Workspace listing
CREATE INDEX "workflow_schedules_workspace_status_created_idx"
  ON "workflow_schedules"("workspace_id", "status", "created_at");

-- Runner assignment tracking
CREATE INDEX "workflow_schedules_runner_idx"
  ON "workflow_schedules"("runner_device_id")
  WHERE "status" IN ('ACTIVE', 'PAUSED');

-- Constraints
ALTER TABLE "workflow_schedules"
  ADD CONSTRAINT "workflow_schedules_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_schedules"
  ADD CONSTRAINT "workflow_schedules_workflow_version_id_fkey"
    FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_schedules"
  ADD CONSTRAINT "workflow_schedules_runner_device_id_fkey"
    FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_schedules"
  ADD CONSTRAINT "workflow_schedules_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_schedules"
  ADD CONSTRAINT "workflow_schedules_archived_by_user_id_fkey"
    FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workflow_schedules"
  ADD CONSTRAINT "workflow_schedules_max_start_delay_range"
    CHECK ("max_start_delay_seconds" BETWEEN 30 AND 3600);

-- =============================================================================
-- WorkflowScheduleOccurrence
-- =============================================================================

CREATE TABLE "workflow_schedule_occurrences" (
  "id"                  UUID                                    NOT NULL DEFAULT gen_random_uuid(),
  "schedule_id"         UUID                                    NOT NULL,
  "workflow_run_id"     UUID                                    UNIQUE,
  "scheduled_for"      TIMESTAMPTZ(3)                          NOT NULL,
  "start_deadline_at"   TIMESTAMPTZ(3)                          NOT NULL,
  "status"              "workflow_schedule_occurrence_status"   NOT NULL DEFAULT 'PENDING',
  -- Skip metadata
  "skip_reason"         VARCHAR(80),
  "skipped_at"          TIMESTAMPTZ(3),
  -- Dispatch metadata
  "dispatched_at"       TIMESTAMPTZ(3),
  -- Completion metadata
  "completed_at"        TIMESTAMPTZ(3),
  "termination_cause"   VARCHAR(80),
  -- Timestamps
  "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_schedule_occurrences_pkey" PRIMARY KEY ("id")
);

-- Unique: one occurrence per (schedule, scheduled instant) — idempotency guarantee
CREATE UNIQUE INDEX "workflow_schedule_occurrences_sched_time_key"
  ON "workflow_schedule_occurrences"("schedule_id", "scheduled_for");

-- Timeout reconciliation index
CREATE INDEX "workflow_schedule_occurrences_deadline_idx"
  ON "workflow_schedule_occurrences"("status", "start_deadline_at")
  WHERE "status" = 'DISPATCHED';

-- Occurrence history for a schedule
CREATE INDEX "workflow_schedule_occurrences_schedule_created_idx"
  ON "workflow_schedule_occurrences"("schedule_id", "created_at" DESC);

-- FK to schedule
ALTER TABLE "workflow_schedule_occurrences"
  ADD CONSTRAINT "workflow_schedule_occurrences_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "workflow_schedules"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK to workflow run (nullable — skipped occurrences have no run)
ALTER TABLE "workflow_schedule_occurrences"
  ADD CONSTRAINT "workflow_schedule_occurrences_workflow_run_id_fkey"
    FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Self-reference: auto_paused_by_occurrence_id
ALTER TABLE "workflow_schedules"
  ADD CONSTRAINT "workflow_schedules_auto_paused_by_occurrence_fkey"
    FOREIGN KEY ("auto_paused_by_occurrence_id")
    REFERENCES "workflow_schedule_occurrences"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- WorkflowRun trigger fields
-- =============================================================================

ALTER TABLE "workflow_runs" ADD COLUMN "trigger" VARCHAR(16) NOT NULL DEFAULT 'manual';
ALTER TABLE "workflow_runs" ADD COLUMN "schedule_id" UUID;
ALTER TABLE "workflow_runs" ADD COLUMN "occurrence_id" UUID;
ALTER TABLE "workflow_runs" ADD COLUMN "scheduled_for" TIMESTAMPTZ(3);
ALTER TABLE "workflow_runs" ADD COLUMN "scheduled_start_deadline_at" TIMESTAMPTZ(3);

-- Only one ACTIVE scheduled run per schedule at a time
-- We track active runs via status, so this constraint prevents concurrent active
-- scheduled runs for the same schedule.
CREATE UNIQUE INDEX "workflow_runs_schedule_active_scheduled_key"
  ON "workflow_runs"("schedule_id")
  WHERE "trigger" = 'scheduled'
    AND "status" IN ('QUEUED', 'CLAIMED', 'RUNNING', 'WAITING_FOR_APPROVAL',
                     'WAITING_FOR_REPAIR', 'CANCEL_REQUESTED');

-- Index for finding runs by schedule
CREATE INDEX "workflow_runs_schedule_idx"
  ON "workflow_runs"("schedule_id")
  WHERE "schedule_id" IS NOT NULL;

-- FK to schedule (nullable for manual runs)
ALTER TABLE "workflow_runs"
  ADD CONSTRAINT "workflow_runs_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "workflow_schedules"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK to occurrence (nullable)
ALTER TABLE "workflow_runs"
  ADD CONSTRAINT "workflow_runs_occurrence_id_fkey"
    FOREIGN KEY ("occurrence_id") REFERENCES "workflow_schedule_occurrences"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- RunnerDevice scheduled_execution capability
-- =============================================================================
-- The capabilities column is a String[] (JSONB array in Prisma).
-- We do NOT add a separate column; the capability is added to the capabilities
-- array when the Runner is in unattended headless mode.
-- The scheduled_execution_v1 capability is advertised via the heartbeat API.

-- =============================================================================
-- Bootstrap: backfill trigger = 'manual' for existing runs
-- =============================================================================

UPDATE "workflow_runs" SET "trigger" = 'manual' WHERE "trigger" IS NULL;

ALTER TABLE "workflow_runs"
  ALTER COLUMN "trigger" SET NOT NULL;
