ALTER TYPE "operational_alert_type" ADD VALUE 'runner_rollout_requires_review';
ALTER TYPE "operational_alert_source_type" ADD VALUE 'runner_release_rollout';
ALTER TYPE "operational_alert_source_type" ADD VALUE 'runner_release_rollout_assignment';

CREATE TYPE "runner_release_catalog_status" AS ENUM ('available', 'deprecated', 'blocked');
CREATE TYPE "runner_release_status_reason" AS ENUM ('superseded', 'end_of_support', 'security_issue', 'integrity_issue', 'compatibility_issue', 'operational_issue');
CREATE TYPE "runner_release_rollout_status" AS ENUM ('draft', 'active', 'paused', 'completed', 'cancelled');
CREATE TYPE "runner_release_rollout_stage_status" AS ENUM ('pending', 'active', 'completed', 'failed_review', 'cancelled');
CREATE TYPE "runner_release_rollout_assignment_status" AS ENUM ('pending', 'target_assigned', 'converged', 'rolled_back', 'failed', 'cancelled');

ALTER TABLE "users"
ADD COLUMN "is_system_administrator" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "runner_releases" (
  "id" UUID NOT NULL,
  "product" VARCHAR(64) NOT NULL,
  "version" VARCHAR(32) NOT NULL,
  "manifest_digest" CHAR(64) NOT NULL,
  "manifest" JSONB NOT NULL,
  "signing_key_id" VARCHAR(128) NOT NULL,
  "source_commit" CHAR(40) NOT NULL,
  "built_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "runner_release_catalog_status" NOT NULL DEFAULT 'available',
  "status_reason_code" "runner_release_status_reason",
  "imported_by_user_id" UUID NOT NULL,
  "status_changed_by_user_id" UUID,
  "status_changed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "runner_releases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "runner_releases_manifest_digest_key" ON "runner_releases"("manifest_digest");
CREATE UNIQUE INDEX "runner_releases_product_version_key" ON "runner_releases"("product", "version");
CREATE INDEX "runner_releases_status_created_at_idx" ON "runner_releases"("status", "created_at");

CREATE TABLE "runner_release_rollouts" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "target_release_id" UUID NOT NULL,
  "client_rollout_id" UUID NOT NULL,
  "request_digest" CHAR(64) NOT NULL,
  "status" "runner_release_rollout_status" NOT NULL DEFAULT 'draft',
  "review_reason" VARCHAR(80),
  "created_by_user_id" UUID NOT NULL,
  "activated_by_user_id" UUID,
  "paused_by_user_id" UUID,
  "cancelled_by_user_id" UUID,
  "activated_at" TIMESTAMPTZ(3),
  "paused_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "runner_release_rollouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "runner_release_rollouts_workspace_client_key" ON "runner_release_rollouts"("workspace_id", "client_rollout_id");
CREATE INDEX "runner_release_rollouts_workspace_status_created_idx" ON "runner_release_rollouts"("workspace_id", "status", "created_at");
CREATE INDEX "runner_release_rollouts_target_status_idx" ON "runner_release_rollouts"("target_release_id", "status");

CREATE TABLE "runner_release_rollout_stages" (
  "id" UUID NOT NULL,
  "rollout_id" UUID NOT NULL,
  "stage_number" INTEGER NOT NULL,
  "status" "runner_release_rollout_stage_status" NOT NULL DEFAULT 'pending',
  "review_reason" VARCHAR(80),
  "activated_by_user_id" UUID,
  "activated_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "failed_review_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "runner_release_rollout_stages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runner_release_rollout_stage_number_check" CHECK ("stage_number" > 0)
);

CREATE UNIQUE INDEX "runner_release_rollout_stages_number_key" ON "runner_release_rollout_stages"("rollout_id", "stage_number");
CREATE INDEX "runner_release_rollout_stages_status_idx" ON "runner_release_rollout_stages"("rollout_id", "status");

CREATE TABLE "runner_release_rollout_assignments" (
  "id" UUID NOT NULL,
  "rollout_id" UUID NOT NULL,
  "stage_id" UUID NOT NULL,
  "runner_device_id" UUID NOT NULL,
  "status" "runner_release_rollout_assignment_status" NOT NULL DEFAULT 'pending',
  "baseline_version" VARCHAR(32),
  "last_observed_version" VARCHAR(32),
  "last_observed_at" TIMESTAMPTZ(3),
  "assigned_at" TIMESTAMPTZ(3),
  "converged_at" TIMESTAMPTZ(3),
  "rolled_back_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "runner_release_rollout_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "runner_release_rollout_assignments_runner_key" ON "runner_release_rollout_assignments"("rollout_id", "runner_device_id");
CREATE INDEX "runner_release_rollout_assignments_stage_status_idx" ON "runner_release_rollout_assignments"("stage_id", "status");
CREATE INDEX "runner_release_rollout_assignments_runner_status_idx" ON "runner_release_rollout_assignments"("runner_device_id", "status");

ALTER TABLE "runner_devices"
ADD COLUMN "desired_release_id" UUID,
ADD COLUMN "desired_rollout_assignment_id" UUID,
ADD COLUMN "desired_assigned_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "runner_devices_desired_assignment_id_key" ON "runner_devices"("desired_rollout_assignment_id");
CREATE INDEX "runner_devices_desired_release_id_idx" ON "runner_devices"("desired_release_id");

CREATE TABLE "system_audit_chain_heads" (
  "scope" VARCHAR(64) NOT NULL,
  "last_sequence" INTEGER NOT NULL DEFAULT 0,
  "last_event_hash" CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "system_audit_chain_heads_pkey" PRIMARY KEY ("scope")
);

CREATE TABLE "system_audit_events" (
  "id" UUID NOT NULL,
  "scope" VARCHAR(64) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "primary_entity_kind" VARCHAR(48) NOT NULL,
  "primary_entity_id" VARCHAR(256) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "source_id" VARCHAR(160) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_digest" CHAR(64) NOT NULL,
  "previous_hash" CHAR(64) NOT NULL,
  "event_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_audit_events_scope_sequence_key" ON "system_audit_events"("scope", "sequence");
CREATE UNIQUE INDEX "system_audit_events_scope_source_key" ON "system_audit_events"("scope", "source_id");
CREATE INDEX "system_audit_events_scope_occurred_idx" ON "system_audit_events"("scope", "occurred_at");

ALTER TABLE "runner_release_rollouts" ADD CONSTRAINT "runner_release_rollouts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_release_rollouts" ADD CONSTRAINT "runner_release_rollouts_target_release_id_fkey" FOREIGN KEY ("target_release_id") REFERENCES "runner_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_release_rollout_stages" ADD CONSTRAINT "runner_release_rollout_stages_rollout_id_fkey" FOREIGN KEY ("rollout_id") REFERENCES "runner_release_rollouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_release_rollout_assignments" ADD CONSTRAINT "runner_release_rollout_assignments_rollout_id_fkey" FOREIGN KEY ("rollout_id") REFERENCES "runner_release_rollouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_release_rollout_assignments" ADD CONSTRAINT "runner_release_rollout_assignments_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "runner_release_rollout_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_release_rollout_assignments" ADD CONSTRAINT "runner_release_rollout_assignments_runner_device_id_fkey" FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_devices" ADD CONSTRAINT "runner_devices_desired_release_id_fkey" FOREIGN KEY ("desired_release_id") REFERENCES "runner_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_devices" ADD CONSTRAINT "runner_devices_desired_rollout_assignment_id_fkey" FOREIGN KEY ("desired_rollout_assignment_id") REFERENCES "runner_release_rollout_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_runner_release_history_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Runner release history cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.product IS DISTINCT FROM OLD.product
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.manifest_digest IS DISTINCT FROM OLD.manifest_digest
    OR NEW.manifest IS DISTINCT FROM OLD.manifest
    OR NEW.signing_key_id IS DISTINCT FROM OLD.signing_key_id
    OR NEW.source_commit IS DISTINCT FROM OLD.source_commit
    OR NEW.built_at IS DISTINCT FROM OLD.built_at
    OR NEW.imported_by_user_id IS DISTINCT FROM OLD.imported_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Runner release identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "runner_releases_immutable_history"
BEFORE UPDATE OR DELETE ON "runner_releases"
FOR EACH ROW EXECUTE FUNCTION reject_runner_release_history_mutation();

CREATE FUNCTION reject_system_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'System audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "system_audit_events_append_only"
BEFORE UPDATE OR DELETE ON "system_audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION reject_system_audit_event_mutation();
