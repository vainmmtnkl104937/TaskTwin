-- Session 37: indexes for bounded list, audit evidence, and component-health
-- hot paths. Historical migrations remain immutable.

CREATE INDEX "operational_component_heartbeats_component_state_latest_idx"
  ON "operational_component_heartbeats"("component_type", "graceful_stopped_at", "latest_heartbeat_at" DESC);

CREATE INDEX "workspace_audit_events_workspace_entity_sequence_idx"
  ON "workspace_audit_events"("workspace_id", "primary_entity_kind", "primary_entity_id", "sequence");

CREATE INDEX "workspace_audit_events_workspace_correlation_sequence_idx"
  ON "workspace_audit_events"("workspace_id", "correlation_id", "sequence");

CREATE INDEX "workflow_runs_workspace_created_id_idx"
  ON "workflow_runs"("workspace_id", "created_at" DESC, "id");

CREATE INDEX "runner_devices_workspace_created_id_idx"
  ON "runner_devices"("workspace_id", "created_at" DESC, "id");

CREATE INDEX "runner_releases_built_id_idx"
  ON "runner_releases"("built_at" DESC, "id");

CREATE INDEX "runner_release_rollouts_workspace_created_id_idx"
  ON "runner_release_rollouts"("workspace_id", "created_at" DESC, "id");
