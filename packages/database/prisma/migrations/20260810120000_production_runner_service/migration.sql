CREATE TYPE "runner_runtime_mode" AS ENUM ('interactive', 'unattended_process', 'service');
CREATE TYPE "runner_autonomy_level" AS ENUM ('interactive', 'process_unattended', 'boot_resilient');
CREATE TYPE "runner_service_status" AS ENUM ('not_applicable', 'starting', 'running', 'degraded', 'draining', 'stopped');
CREATE TYPE "runner_secret_unlock_mode" AS ENUM ('none', 'manual', 'os_native');

ALTER TABLE "runner_devices"
  ADD COLUMN "runtime_mode" "runner_runtime_mode",
  ADD COLUMN "autonomy_level" "runner_autonomy_level",
  ADD COLUMN "service_status" "runner_service_status",
  ADD COLUMN "secret_unlock_mode" "runner_secret_unlock_mode",
  ADD COLUMN "restart_resilient" BOOLEAN,
  ADD COLUMN "runtime_metadata_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "runtime_metadata_updated_at" TIMESTAMPTZ(3);
