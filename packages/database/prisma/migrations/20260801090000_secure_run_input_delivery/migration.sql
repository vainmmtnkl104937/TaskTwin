-- Session 18: end-to-end encrypted runtime input delivery.
CREATE TYPE "runner_encryption_key_status" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "workflow_run_input_preparation_status" AS ENUM ('PENDING', 'CONSUMED');

ALTER TABLE "runner_devices"
ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "capabilities_updated_at" TIMESTAMPTZ(3);

CREATE TABLE "runner_encryption_keys" (
  "id" UUID NOT NULL,
  "runner_device_id" UUID NOT NULL,
  "key_id" VARCHAR(64) NOT NULL,
  "profile" VARCHAR(64) NOT NULL,
  "algorithm" VARCHAR(32) NOT NULL,
  "public_key_spki" TEXT NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "status" "runner_encryption_key_status" NOT NULL DEFAULT 'ACTIVE',
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "runner_encryption_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_run_input_preparations" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "runner_device_id" UUID NOT NULL,
  "runner_encryption_key_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "client_preparation_id" UUID NOT NULL,
  "client_run_id" UUID NOT NULL,
  "reserved_run_id" UUID NOT NULL,
  "status" "workflow_run_input_preparation_status" NOT NULL DEFAULT 'PENDING',
  "variable_manifest" JSONB NOT NULL,
  "secret_manifest" JSONB NOT NULL,
  "allowed_origins" JSONB NOT NULL,
  "execution_options" JSONB NOT NULL,
  "definition_digest" CHAR(64) NOT NULL,
  "aad" JSONB NOT NULL,
  "request_digest" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_run_input_preparations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_run_input_envelopes" (
  "id" UUID NOT NULL,
  "workflow_run_id" UUID NOT NULL,
  "preparation_id" UUID NOT NULL,
  "runner_encryption_key_id" UUID NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "profile" VARCHAR(64) NOT NULL,
  "content_encryption" VARCHAR(32) NOT NULL,
  "key_encryption" VARCHAR(32) NOT NULL,
  "key_id" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "aad" TEXT NOT NULL,
  "iv" VARCHAR(32) NOT NULL,
  "wrapped_key" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "ciphertext_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_run_input_envelopes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "runner_encryption_keys_fingerprint_key" ON "runner_encryption_keys"("fingerprint");
CREATE UNIQUE INDEX "runner_encryption_keys_runner_device_id_key_id_key" ON "runner_encryption_keys"("runner_device_id", "key_id");
CREATE INDEX "runner_encryption_keys_runner_device_id_status_idx" ON "runner_encryption_keys"("runner_device_id", "status");
CREATE UNIQUE INDEX "runner_encryption_keys_one_active_per_runner_key" ON "runner_encryption_keys"("runner_device_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "run_input_preparations_workspace_client_prep_key" ON "workflow_run_input_preparations"("workspace_id", "client_preparation_id");
CREATE UNIQUE INDEX "workflow_run_input_preparations_workspace_client_run_key" ON "workflow_run_input_preparations"("workspace_id", "client_run_id");
CREATE UNIQUE INDEX "workflow_run_input_preparations_reserved_run_id_key" ON "workflow_run_input_preparations"("reserved_run_id");
CREATE INDEX "workflow_run_input_preparations_status_expires_at_idx" ON "workflow_run_input_preparations"("status", "expires_at");
CREATE INDEX "workflow_run_input_preparations_workflow_version_created_at_idx" ON "workflow_run_input_preparations"("workflow_version_id", "created_at");
CREATE INDEX "workflow_run_input_preparations_runner_device_created_at_idx" ON "workflow_run_input_preparations"("runner_device_id", "created_at");
CREATE UNIQUE INDEX "workflow_run_input_envelopes_workflow_run_id_key" ON "workflow_run_input_envelopes"("workflow_run_id");
CREATE UNIQUE INDEX "workflow_run_input_envelopes_preparation_id_key" ON "workflow_run_input_envelopes"("preparation_id");
CREATE INDEX "workflow_run_input_envelopes_key_created_at_idx" ON "workflow_run_input_envelopes"("runner_encryption_key_id", "created_at");

ALTER TABLE "runner_encryption_keys" ADD CONSTRAINT "runner_encryption_keys_runner_device_id_fkey" FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_input_preparations" ADD CONSTRAINT "workflow_run_input_preparations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_input_preparations" ADD CONSTRAINT "workflow_run_input_preparations_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_input_preparations" ADD CONSTRAINT "workflow_run_input_preparations_runner_device_id_fkey" FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_input_preparations" ADD CONSTRAINT "workflow_run_input_preparations_runner_encryption_key_id_fkey" FOREIGN KEY ("runner_encryption_key_id") REFERENCES "runner_encryption_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_input_preparations" ADD CONSTRAINT "workflow_run_input_preparations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_input_envelopes" ADD CONSTRAINT "workflow_run_input_envelopes_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_input_envelopes" ADD CONSTRAINT "workflow_run_input_envelopes_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "workflow_run_input_preparations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_input_envelopes" ADD CONSTRAINT "workflow_run_input_envelopes_runner_encryption_key_id_fkey" FOREIGN KEY ("runner_encryption_key_id") REFERENCES "runner_encryption_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
