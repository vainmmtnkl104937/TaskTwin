ALTER TYPE "workflow_run_status" ADD VALUE 'WAITING_FOR_APPROVAL' AFTER 'RUNNING';
ALTER TYPE "workflow_run_step_status" ADD VALUE 'WAITING_FOR_APPROVAL' AFTER 'RUNNING';

CREATE TYPE "workflow_approval_request_status" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'INVALIDATED'
);

CREATE TYPE "workflow_approval_risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "workflow_approval_requests" (
  "id" UUID NOT NULL,
  "workflow_run_id" UUID NOT NULL,
  "runner_device_id" UUID NOT NULL,
  "approval_step_id" VARCHAR(256) NOT NULL,
  "gated_step_id" VARCHAR(256) NOT NULL,
  "client_request_id" UUID NOT NULL,
  "request_digest" CHAR(64) NOT NULL,
  "status" "workflow_approval_request_status" NOT NULL DEFAULT 'PENDING',
  "risk_level" "workflow_approval_risk_level" NOT NULL,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "resolved_at" TIMESTAMPTZ(3),
  "decided_by_user_id" UUID,
  "client_decision_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "workflow_approval_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_approval_requests_step_binding_check"
    CHECK ("approval_step_id" <> "gated_step_id"),
  CONSTRAINT "workflow_approval_requests_expiry_check"
    CHECK ("expires_at" > "requested_at"),
  CONSTRAINT "workflow_approval_requests_resolution_check"
    CHECK (
      ("status" = 'PENDING' AND "resolved_at" IS NULL AND "decided_by_user_id" IS NULL AND "client_decision_id" IS NULL)
      OR
      ("status" IN ('APPROVED', 'REJECTED') AND "resolved_at" IS NOT NULL AND "decided_by_user_id" IS NOT NULL AND "client_decision_id" IS NOT NULL)
      OR
      ("status" IN ('EXPIRED', 'CANCELLED', 'INVALIDATED') AND "resolved_at" IS NOT NULL AND "decided_by_user_id" IS NULL AND "client_decision_id" IS NULL)
    )
);

CREATE UNIQUE INDEX "workflow_approval_requests_client_decision_id_key"
ON "workflow_approval_requests"("client_decision_id");
CREATE UNIQUE INDEX "workflow_approval_requests_run_step_key"
ON "workflow_approval_requests"("workflow_run_id", "approval_step_id");
CREATE UNIQUE INDEX "workflow_approval_requests_run_client_request_key"
ON "workflow_approval_requests"("workflow_run_id", "client_request_id");
CREATE INDEX "workflow_approval_requests_status_expires_at_idx"
ON "workflow_approval_requests"("status", "expires_at");
CREATE INDEX "workflow_approval_requests_runner_status_idx"
ON "workflow_approval_requests"("runner_device_id", "status");
CREATE INDEX "workflow_approval_requests_decided_by_idx"
ON "workflow_approval_requests"("decided_by_user_id");

ALTER TABLE "workflow_approval_requests"
ADD CONSTRAINT "workflow_approval_requests_workflow_run_id_fkey"
FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_approval_requests"
ADD CONSTRAINT "workflow_approval_requests_runner_device_id_fkey"
FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_approval_requests"
ADD CONSTRAINT "workflow_approval_requests_decided_by_user_id_fkey"
FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "workflow_runs_one_active_per_runner_key";
CREATE UNIQUE INDEX "workflow_runs_one_active_per_runner_key"
ON "workflow_runs"("runner_device_id")
WHERE "status" IN ('CLAIMED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'CANCEL_REQUESTED');
