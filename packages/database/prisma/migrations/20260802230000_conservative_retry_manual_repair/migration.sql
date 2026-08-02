ALTER TYPE "workflow_run_status" ADD VALUE 'WAITING_FOR_REPAIR' AFTER 'WAITING_FOR_APPROVAL';
ALTER TYPE "workflow_run_step_status" ADD VALUE 'WAITING_FOR_REPAIR' AFTER 'WAITING_FOR_APPROVAL';

CREATE TYPE "workflow_run_step_attempt_trigger" AS ENUM ('INITIAL', 'AUTOMATIC_RETRY', 'MANUAL_RETRY');
CREATE TYPE "workflow_run_step_attempt_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'INTERRUPTED');
CREATE TYPE "workflow_execution_effect_certainty" AS ENUM ('NOT_STARTED', 'READ_ONLY', 'SIDE_EFFECT_POSSIBLE', 'COMPLETED', 'UNKNOWN');
CREATE TYPE "workflow_repair_request_status" AS ENUM ('PENDING', 'RETRY_APPROVED', 'ABORTED', 'EXPIRED', 'CANCELLED', 'INVALIDATED');

DROP INDEX "workflow_runs_one_active_per_runner_key";
CREATE UNIQUE INDEX "workflow_runs_one_active_per_runner_key"
ON "workflow_runs"("runner_device_id")
WHERE "status" IN ('CLAIMED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_REPAIR', 'CANCEL_REQUESTED');

CREATE TABLE "workflow_repair_requests" (
  "id" UUID NOT NULL,
  "workflow_run_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "runner_device_id" UUID NOT NULL,
  "step_id" VARCHAR(256) NOT NULL,
  "step_index" INTEGER NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "client_request_id" UUID NOT NULL,
  "request_digest" CHAR(64) NOT NULL,
  "safe_error_code" VARCHAR(80) NOT NULL,
  "effect_certainty" "workflow_execution_effect_certainty" NOT NULL,
  "retry_allowed" BOOLEAN NOT NULL,
  "status" "workflow_repair_request_status" NOT NULL DEFAULT 'PENDING',
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "resolved_at" TIMESTAMPTZ(3),
  "decided_by_user_id" UUID,
  "client_decision_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_repair_requests_step_index_check" CHECK ("step_index" >= 0),
  CONSTRAINT "workflow_repair_requests_attempt_number_check" CHECK ("attempt_number" BETWEEN 1 AND 3),
  CONSTRAINT "workflow_repair_requests_expiry_check" CHECK ("expires_at" > "requested_at"),
  CONSTRAINT "workflow_repair_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_run_step_attempts" (
  "id" UUID NOT NULL,
  "workflow_run_id" UUID NOT NULL,
  "workflow_run_step_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "trigger" "workflow_run_step_attempt_trigger" NOT NULL,
  "status" "workflow_run_step_attempt_status" NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3),
  "duration_ms" INTEGER,
  "safe_error_code" VARCHAR(80),
  "effect_certainty" "workflow_execution_effect_certainty" NOT NULL,
  "authorized_by_repair_request_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_run_step_attempts_attempt_number_check" CHECK ("attempt_number" BETWEEN 1 AND 3),
  CONSTRAINT "workflow_run_step_attempts_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
  CONSTRAINT "workflow_run_step_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_repair_requests_client_decision_id_key" ON "workflow_repair_requests"("client_decision_id");
CREATE UNIQUE INDEX "workflow_repair_requests_run_step_attempt_key" ON "workflow_repair_requests"("workflow_run_id", "step_id", "attempt_number");
CREATE UNIQUE INDEX "workflow_repair_requests_run_client_request_key" ON "workflow_repair_requests"("workflow_run_id", "client_request_id");
CREATE UNIQUE INDEX "workflow_repair_requests_one_pending_per_run_key" ON "workflow_repair_requests"("workflow_run_id") WHERE "status" = 'PENDING';
CREATE INDEX "workflow_repair_requests_workspace_status_idx" ON "workflow_repair_requests"("workspace_id", "status", "requested_at");
CREATE INDEX "workflow_repair_requests_status_expires_at_idx" ON "workflow_repair_requests"("status", "expires_at");
CREATE INDEX "workflow_repair_requests_runner_status_idx" ON "workflow_repair_requests"("runner_device_id", "status");
CREATE INDEX "workflow_repair_requests_decided_by_idx" ON "workflow_repair_requests"("decided_by_user_id");

CREATE UNIQUE INDEX "workflow_run_step_attempts_repair_request_id_key" ON "workflow_run_step_attempts"("authorized_by_repair_request_id");
CREATE UNIQUE INDEX "workflow_run_step_attempts_step_attempt_key" ON "workflow_run_step_attempts"("workflow_run_step_id", "attempt_number");
CREATE INDEX "workflow_run_step_attempts_run_status_idx" ON "workflow_run_step_attempts"("workflow_run_id", "status");

ALTER TABLE "workflow_repair_requests" ADD CONSTRAINT "workflow_repair_requests_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_repair_requests" ADD CONSTRAINT "workflow_repair_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_repair_requests" ADD CONSTRAINT "workflow_repair_requests_runner_device_id_fkey" FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_repair_requests" ADD CONSTRAINT "workflow_repair_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_step_attempts" ADD CONSTRAINT "workflow_run_step_attempts_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_run_step_attempts" ADD CONSTRAINT "workflow_run_step_attempts_workflow_run_step_id_fkey" FOREIGN KEY ("workflow_run_step_id") REFERENCES "workflow_run_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_run_step_attempts" ADD CONSTRAINT "workflow_run_step_attempts_authorized_by_repair_request_id_fkey" FOREIGN KEY ("authorized_by_repair_request_id") REFERENCES "workflow_repair_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
