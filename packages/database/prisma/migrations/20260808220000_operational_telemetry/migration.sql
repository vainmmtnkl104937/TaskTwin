CREATE TYPE "operational_component_type" AS ENUM ('control_plane_api', 'scheduler', 'notification_worker');

CREATE TABLE "operational_component_heartbeats" (
  "process_instance_id" UUID NOT NULL,
  "component_type" "operational_component_type" NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "latest_heartbeat_at" TIMESTAMPTZ(3) NOT NULL,
  "graceful_stopped_at" TIMESTAMPTZ(3),
  CONSTRAINT "operational_component_heartbeats_pkey" PRIMARY KEY ("process_instance_id"),
  CONSTRAINT "component_heartbeats_timestamp_check" CHECK (
    "latest_heartbeat_at" >= "started_at"
    AND ("graceful_stopped_at" IS NULL OR "graceful_stopped_at" >= "started_at")
  )
);

CREATE TABLE "workspace_audit_verification_states" (
  "workspace_id" UUID NOT NULL,
  "valid" BOOLEAN NOT NULL,
  "checked_event_count" INTEGER NOT NULL,
  "first_sequence" INTEGER,
  "last_sequence" INTEGER,
  "failure_sequence" INTEGER,
  "safe_failure_code" VARCHAR(80),
  "verified_at" TIMESTAMPTZ(3) NOT NULL,
  "verified_by_user_id" UUID,
  CONSTRAINT "workspace_audit_verification_states_pkey" PRIMARY KEY ("workspace_id"),
  CONSTRAINT "audit_verification_count_check" CHECK ("checked_event_count" >= 0),
  CONSTRAINT "audit_verification_sequence_check" CHECK (
    ("checked_event_count" = 0 AND "first_sequence" IS NULL AND "last_sequence" IS NULL)
    OR ("checked_event_count" > 0 AND "first_sequence" > 0 AND "last_sequence" >= "first_sequence")
  ),
  CONSTRAINT "audit_verification_failure_check" CHECK (
    ("valid" AND "failure_sequence" IS NULL AND "safe_failure_code" IS NULL)
    OR (NOT "valid" AND "failure_sequence" IS NOT NULL AND "safe_failure_code" ~ '^[A-Z][A-Z0-9_]{1,79}$')
  )
);

CREATE INDEX "component_heartbeats_running_health_idx" ON "operational_component_heartbeats"("component_type", "latest_heartbeat_at" DESC) WHERE "graceful_stopped_at" IS NULL;
CREATE INDEX "component_heartbeats_stopped_health_idx" ON "operational_component_heartbeats"("component_type", "latest_heartbeat_at" DESC) WHERE "graceful_stopped_at" IS NOT NULL;
CREATE INDEX "workflow_runs_workspace_status_finished_idx" ON "workflow_runs"("workspace_id", "status", "finished_at");
CREATE INDEX "workflow_repair_requests_workspace_status_resolved_idx" ON "workflow_repair_requests"("workspace_id", "status", "resolved_at");
CREATE INDEX "workflow_approval_requests_status_requested_run_idx" ON "workflow_approval_requests"("status", "requested_at", "workflow_run_id");
CREATE INDEX "workflow_approval_requests_status_resolved_run_idx" ON "workflow_approval_requests"("status", "resolved_at", "workflow_run_id");
CREATE INDEX "notification_outbox_messages_workspace_status_delivered_idx" ON "notification_outbox_messages"("workspace_id", "status", "delivered_at");

ALTER TABLE "workspace_audit_verification_states" ADD CONSTRAINT "workspace_audit_verification_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_audit_verification_states" ADD CONSTRAINT "workspace_audit_verification_states_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
