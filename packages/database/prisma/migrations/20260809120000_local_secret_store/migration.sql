CREATE TYPE "runner_secret_store_status" AS ENUM ('READY', 'LOCKED', 'UNAVAILABLE', 'CORRUPTED');
CREATE TYPE "workflow_run_secret_resolution_mode" AS ENUM ('LOCAL_STORE');

CREATE TABLE "runner_secret_inventories" (
  "runner_device_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "vault_id" UUID NOT NULL,
  "vault_revision" INTEGER NOT NULL,
  "store_status" "runner_secret_store_status" NOT NULL,
  "inventory_digest" CHAR(64) NOT NULL,
  "last_synchronized_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "runner_secret_inventories_pkey" PRIMARY KEY ("runner_device_id"),
  CONSTRAINT "runner_secret_inventories_revision_check" CHECK ("vault_revision" > 0),
  CONSTRAINT "runner_secret_inventories_digest_check" CHECK ("inventory_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "runner_secret_inventory_entries" (
  "runner_device_id" UUID NOT NULL,
  "alias" VARCHAR(80) NOT NULL,
  "secret_version_id" UUID NOT NULL,
  CONSTRAINT "runner_secret_inventory_entries_pkey" PRIMARY KEY ("runner_device_id", "alias")
);

CREATE UNIQUE INDEX "runner_secret_inventories_vault_id_key" ON "runner_secret_inventories"("vault_id");
CREATE UNIQUE INDEX "runner_secret_inventory_entries_version_key" ON "runner_secret_inventory_entries"("runner_device_id", "secret_version_id");

ALTER TABLE "runner_secret_inventories" ADD CONSTRAINT "runner_secret_inventories_runner_device_id_fkey"
  FOREIGN KEY ("runner_device_id") REFERENCES "runner_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_secret_inventories" ADD CONSTRAINT "runner_secret_inventories_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runner_secret_inventory_entries" ADD CONSTRAINT "runner_secret_inventory_entries_runner_device_id_fkey"
  FOREIGN KEY ("runner_device_id") REFERENCES "runner_secret_inventories"("runner_device_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_runs"
  ADD COLUMN "secret_resolution_mode" "workflow_run_secret_resolution_mode",
  ADD COLUMN "secret_vault_id" UUID,
  ADD COLUMN "secret_inventory_revision" INTEGER,
  ADD COLUMN "secret_inventory_digest" CHAR(64),
  ADD CONSTRAINT "workflow_runs_secret_inventory_pin_check" CHECK (
    ("secret_resolution_mode" IS NULL AND "secret_vault_id" IS NULL AND
     "secret_inventory_revision" IS NULL AND "secret_inventory_digest" IS NULL)
    OR
    ("secret_resolution_mode" = 'LOCAL_STORE' AND "secret_vault_id" IS NOT NULL AND
     "secret_inventory_revision" > 0 AND "secret_inventory_digest" ~ '^[0-9a-f]{64}$')
  );
