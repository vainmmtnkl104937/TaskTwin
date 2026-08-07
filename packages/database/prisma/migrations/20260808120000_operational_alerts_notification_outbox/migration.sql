CREATE TYPE "operational_alert_type" AS ENUM ('approval_required', 'repair_required', 'run_failed', 'run_timed_out', 'run_interrupted', 'schedule_auto_paused', 'audit_integrity_failed');
CREATE TYPE "operational_alert_severity" AS ENUM ('info', 'warning', 'error', 'critical');
CREATE TYPE "operational_alert_status" AS ENUM ('active', 'resolved', 'informational');
CREATE TYPE "operational_alert_source_type" AS ENUM ('approval_request', 'repair_request', 'workflow_run', 'workflow_schedule', 'audit_verification_failure');
CREATE TYPE "notification_channel" AS ENUM ('IN_APP');
CREATE TYPE "notification_outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD_LETTER');

CREATE TABLE "operational_alerts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL,
  "type" "operational_alert_type" NOT NULL, "severity" "operational_alert_severity" NOT NULL,
  "status" "operational_alert_status" NOT NULL, "source_type" "operational_alert_source_type" NOT NULL,
  "source_id" VARCHAR(256) NOT NULL, "contract_digest" CHAR(64) NOT NULL,
  "primary_entity_type" VARCHAR(48) NOT NULL, "primary_entity_id" VARCHAR(256) NOT NULL,
  "related_entities" JSONB NOT NULL, "template_key" VARCHAR(64) NOT NULL,
  "template_version" INTEGER NOT NULL, "template_parameters" JSONB NOT NULL,
  "action_target" JSONB NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3), "resolved_by_user_id" UUID, "resolution_reason" VARCHAR(32),
  CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_alerts_resolution_check" CHECK (
    ("status" = 'resolved' AND "resolved_at" IS NOT NULL AND "resolution_reason" IS NOT NULL)
    OR ("status" <> 'resolved' AND "resolved_at" IS NULL AND "resolved_by_user_id" IS NULL AND "resolution_reason" IS NULL)
  )
);

CREATE TABLE "notification_outbox_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "alert_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL, "channel" "notification_channel" NOT NULL DEFAULT 'IN_APP',
  "deduplication_key" VARCHAR(256) NOT NULL, "status" "notification_outbox_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0, "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_by" VARCHAR(96), "locked_until" TIMESTAMPTZ(3), "last_error_code" VARCHAR(80),
  "delivered_at" TIMESTAMPTZ(3), "dead_lettered_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "notification_outbox_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_outbox_attempt_count_check" CHECK ("attempt_count" BETWEEN 0 AND 5),
  CONSTRAINT "notification_outbox_lock_check" CHECK (("status" = 'PROCESSING') = ("locked_by" IS NOT NULL AND "locked_until" IS NOT NULL)),
  CONSTRAINT "notification_outbox_terminal_check" CHECK (
    ("status" = 'DELIVERED' AND "delivered_at" IS NOT NULL AND "dead_lettered_at" IS NULL)
    OR ("status" = 'DEAD_LETTER' AND "dead_lettered_at" IS NOT NULL AND "delivered_at" IS NULL)
    OR ("status" IN ('PENDING', 'PROCESSING') AND "delivered_at" IS NULL AND "dead_lettered_at" IS NULL)
  ),
  CONSTRAINT "notification_outbox_safe_error_check" CHECK ("last_error_code" IS NULL OR "last_error_code" ~ '^[A-Z][A-Z0-9_]{1,79}$')
);

CREATE TABLE "user_notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "recipient_user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL, "alert_id" UUID NOT NULL,
  "delivered_at" TIMESTAMPTZ(3) NOT NULL, "read_at" TIMESTAMPTZ(3),
  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_alerts_source_identity_key" ON "operational_alerts"("workspace_id", "type", "source_type", "source_id");
CREATE INDEX "operational_alerts_workspace_status_created_idx" ON "operational_alerts"("workspace_id", "status", "created_at");
CREATE INDEX "operational_alerts_primary_entity_idx" ON "operational_alerts"("primary_entity_type", "primary_entity_id");
CREATE UNIQUE INDEX "notification_outbox_messages_dedup_key" ON "notification_outbox_messages"("deduplication_key");
CREATE UNIQUE INDEX "notification_outbox_messages_alert_recipient_channel_key" ON "notification_outbox_messages"("alert_id", "recipient_user_id", "channel");
CREATE INDEX "notification_outbox_messages_due_idx" ON "notification_outbox_messages"("status", "available_at");
CREATE INDEX "notification_outbox_messages_lock_idx" ON "notification_outbox_messages"("status", "locked_until");
CREATE INDEX "notification_outbox_messages_recipient_idx" ON "notification_outbox_messages"("recipient_user_id", "created_at");
CREATE UNIQUE INDEX "user_notifications_alert_recipient_key" ON "user_notifications"("alert_id", "recipient_user_id");
CREATE INDEX "user_notifications_recipient_delivered_idx" ON "user_notifications"("recipient_user_id", "delivered_at");
CREATE INDEX "user_notifications_inbox_idx" ON "user_notifications"("recipient_user_id", "workspace_id", "read_at", "delivered_at");

ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_outbox_messages" ADD CONSTRAINT "notification_outbox_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_outbox_messages" ADD CONSTRAINT "notification_outbox_messages_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "operational_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_outbox_messages" ADD CONSTRAINT "notification_outbox_messages_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "operational_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
