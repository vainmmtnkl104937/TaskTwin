ALTER TYPE "operational_alert_source_type"
  ADD VALUE 'workflow_schedule_occurrence' AFTER 'workflow_schedule';

ALTER TABLE "runner_devices"
  ADD COLUMN "run_protocol_version" INTEGER,
  ADD COLUMN "workflow_schema_version" INTEGER,
  ADD COLUMN "local_state_schema_version" INTEGER,
  ADD COLUMN "software_metadata_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "software_metadata_updated_at" TIMESTAMPTZ(3);

ALTER TABLE "runner_devices"
  ADD CONSTRAINT "runner_devices_run_protocol_version_check"
    CHECK ("run_protocol_version" IS NULL OR "run_protocol_version" > 0),
  ADD CONSTRAINT "runner_devices_workflow_schema_version_check"
    CHECK ("workflow_schema_version" IS NULL OR "workflow_schema_version" > 0),
  ADD CONSTRAINT "runner_devices_local_state_schema_version_check"
    CHECK ("local_state_schema_version" IS NULL OR "local_state_schema_version" > 0),
  ADD CONSTRAINT "runner_devices_software_metadata_revision_check"
    CHECK ("software_metadata_revision" >= 0);

COMMENT ON COLUMN "runner_devices"."run_protocol_version" IS
  'Last accepted Runner execution protocol version; NULL means the Runner has not reported a complete software identity.';
COMMENT ON COLUMN "runner_devices"."workflow_schema_version" IS
  'Last accepted readable Workflow definition schema version.';
COMMENT ON COLUMN "runner_devices"."local_state_schema_version" IS
  'Last accepted local Runner-state schema version. Vault metadata is deliberately not reported.';
COMMENT ON COLUMN "runner_devices"."software_metadata_updated_at" IS
  'Database timestamp of the last material accepted software identity change.';
