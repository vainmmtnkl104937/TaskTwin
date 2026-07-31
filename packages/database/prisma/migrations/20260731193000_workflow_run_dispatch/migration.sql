-- Session 17: persisted WorkflowRun dispatch, leases, progress and completion.
CREATE TYPE "workflow_run_status" AS ENUM (
  'QUEUED', 'CLAIMED', 'RUNNING', 'CANCEL_REQUESTED',
  'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'INTERRUPTED'
);

CREATE TYPE "workflow_run_step_status" AS ENUM (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED',
  'TIMED_OUT', 'SKIPPED', 'INTERRUPTED'
);

CREATE TABLE "workflow_runs" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "runner_device_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "client_run_id" UUID NOT NULL,
  "status" "workflow_run_status" NOT NULL DEFAULT 'QUEUED',
  "run_protocol_version" INTEGER NOT NULL,
  "workflow_engine_version" INTEGER NOT NULL,
  "definition_digest" CHAR(64) NOT NULL,
  "allowed_origins" JSONB NOT NULL,
  "execution_options" JSONB NOT NULL,
  "claim_attempt_id" UUID,
  "lease_token_hash" CHAR(64),
  "lease_expires_at" TIMESTAMPTZ(3),
  "claimed_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "last_progress_sequence" INTEGER NOT NULL DEFAULT 0,
  "last_engine_status" VARCHAR(32),
  "cancel_requested_at" TIMESTAMPTZ(3),
  "cancel_requested_by_user_id" UUID,
  "client_completion_id" UUID,
  "completion_digest" CHAR(64),
  "final_result" JSONB,
  "termination_cause" VARCHAR(80),
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_runs_progress_sequence_check" CHECK ("last_progress_sequence" >= 0)
);

CREATE TABLE "workflow_run_steps" (
  "id" UUID NOT NULL,
  "workflow_run_id" UUID NOT NULL,
  "source_step_id" VARCHAR(256) NOT NULL,
  "source_step_index" INTEGER NOT NULL,
  "step_type" VARCHAR(32) NOT NULL,
  "status" "workflow_run_step_status" NOT NULL DEFAULT 'PENDING',
  "last_engine_status" VARCHAR(32),
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "duration_ms" INTEGER,
  "error_code" VARCHAR(80),
  "skipped_reason" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_run_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_run_steps_source_index_check" CHECK ("source_step_index" >= 0),
  CONSTRAINT "workflow_run_steps_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0)
);

CREATE TABLE "workflow_run_progress_batches" (
  "id" UUID NOT NULL,
  "workflow_run_id" UUID NOT NULL,
  "client_batch_id" UUID NOT NULL,
  "first_sequence" INTEGER NOT NULL,
  "last_sequence" INTEGER NOT NULL,
  "event_count" INTEGER NOT NULL,
  "payload_digest" CHAR(64) NOT NULL,
  "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_run_progress_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_run_progress_batches_range_check"
    CHECK ("first_sequence" > 0 AND "last_sequence" >= "first_sequence"
      AND "event_count" = "last_sequence" - "first_sequence" + 1)
);

CREATE UNIQUE INDEX "workflow_runs_workspace_id_client_run_id_key"
ON "workflow_runs"("workspace_id", "client_run_id");
CREATE UNIQUE INDEX "workflow_runs_runner_device_id_claim_attempt_id_key"
ON "workflow_runs"("runner_device_id", "claim_attempt_id");
CREATE UNIQUE INDEX "workflow_runs_one_active_per_runner_key"
ON "workflow_runs"("runner_device_id")
WHERE "status" IN ('CLAIMED', 'RUNNING', 'CANCEL_REQUESTED');
CREATE INDEX "workflow_runs_runner_device_id_status_created_at_idx"
ON "workflow_runs"("runner_device_id", "status", "created_at");
CREATE INDEX "workflow_runs_workspace_id_created_at_idx"
ON "workflow_runs"("workspace_id", "created_at");
CREATE INDEX "workflow_runs_workflow_id_created_at_idx"
ON "workflow_runs"("workflow_id", "created_at");
CREATE INDEX "workflow_runs_workflow_version_id_created_at_idx"
ON "workflow_runs"("workflow_version_id", "created_at");
CREATE INDEX "workflow_runs_status_lease_expires_at_idx"
ON "workflow_runs"("status", "lease_expires_at");
CREATE INDEX "workflow_runs_created_by_user_id_created_at_idx"
ON "workflow_runs"("created_by_user_id", "created_at");
CREATE INDEX "workflow_runs_cancel_requested_by_user_id_idx"
ON "workflow_runs"("cancel_requested_by_user_id");

CREATE UNIQUE INDEX "workflow_run_steps_run_id_source_step_id_key"
ON "workflow_run_steps"("workflow_run_id", "source_step_id");
CREATE UNIQUE INDEX "workflow_run_steps_run_id_source_step_index_key"
ON "workflow_run_steps"("workflow_run_id", "source_step_index");
CREATE INDEX "workflow_run_steps_run_id_status_idx"
ON "workflow_run_steps"("workflow_run_id", "status");

CREATE UNIQUE INDEX "workflow_run_progress_batches_run_id_client_batch_id_key"
ON "workflow_run_progress_batches"("workflow_run_id", "client_batch_id");
CREATE INDEX "workflow_run_progress_batches_run_id_sequence_idx"
ON "workflow_run_progress_batches"("workflow_run_id", "first_sequence", "last_sequence");

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fkey"
FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_version_id_fkey"
FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_runner_device_id_fkey"
FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_cancel_requested_by_user_id_fkey"
FOREIGN KEY ("cancel_requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_workflow_run_id_fkey"
FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_run_progress_batches" ADD CONSTRAINT "workflow_run_progress_batches_workflow_run_id_fkey"
FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
