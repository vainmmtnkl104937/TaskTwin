-- =============================================================================
-- Session 25: Append-only Workspace Audit Trail
-- =============================================================================
-- This migration introduces:
--   * workspace_audit_chain_heads (one row per Workspace, current head)
--   * workspace_audit_events      (append-only event log, hash-chained)
--   * tasktwin_block_audit_mutation() (trigger function)
--   * BEFORE UPDATE / DELETE / TRUNCATE triggers on workspace_audit_events
--
-- Database-administrator limitations
-- ---------------------------------
-- The triggers are defence-in-depth for application connections. They do NOT
-- protect against a privileged database administrator or a database
-- administrator role that can:
--   * drop the trigger function or any of the triggers;
--   * temporarily disable the triggers (e.g. `ALTER TABLE ... DISABLE
--     TRIGGER USER;`) and rewrite the audit table;
--   * alter the trigger function so it no longer raises the immutability
--     exception;
--   * rewrite the entire chain-head and event rows by replacing the
--     underlying rows (e.g. `TRUNCATE ... RESTART IDENTITY` followed by
--     manual INSERT) outside of an application transaction.
-- A privileged role may also drop or alter the chain-head row and any
-- sequencing is enforced only by application code inside the same
-- transaction as the domain mutation.
-- In short: the application guarantees append-only behaviour for any
-- connection that cannot bypass PostgreSQL triggers; the protections are
-- NOT a substitute for cryptographic external anchoring, signature
-- verification, retention policy, or a trusted auditor outside the
-- database.
-- =============================================================================

CREATE TABLE "workspace_audit_chain_heads" (
  "workspace_id"    UUID         NOT NULL,
  "last_sequence"   INTEGER      NOT NULL DEFAULT 0,
  "last_event_hash" CHAR(64)     NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  "last_event_type" VARCHAR(80),
  "last_event_at"   TIMESTAMPTZ(3),
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_audit_chain_heads_pkey" PRIMARY KEY ("workspace_id")
);

CREATE TABLE "workspace_audit_events" (
  "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id"        UUID         NOT NULL,
  "sequence"            INTEGER      NOT NULL,
  "schema_version"      INTEGER      NOT NULL,
  "event_type"          VARCHAR(80)  NOT NULL,
  "actor_type"          VARCHAR(16)  NOT NULL,
  "actor_id"            VARCHAR(64)  NOT NULL,
  "actor_reason"        VARCHAR(48),
  "primary_entity_kind" VARCHAR(48)  NOT NULL,
  "primary_entity_id"   VARCHAR(256) NOT NULL,
  "related_entities"    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  "occurred_at"         TIMESTAMPTZ(3) NOT NULL,
  "source_id"           VARCHAR(160) NOT NULL,
  "correlation_id"      VARCHAR(80),
  "payload"             JSONB        NOT NULL,
  "payload_digest"      CHAR(64)     NOT NULL,
  "previous_hash"       CHAR(64)     NOT NULL,
  "event_hash"          CHAR(64)     NOT NULL,
  "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_audit_events_workspace_sequence_key"
  ON "workspace_audit_events"("workspace_id", "sequence");
CREATE UNIQUE INDEX "workspace_audit_events_workspace_source_id_key"
  ON "workspace_audit_events"("workspace_id", "source_id");
CREATE INDEX "workspace_audit_events_workspace_created_at_idx"
  ON "workspace_audit_events"("workspace_id", "created_at");
CREATE INDEX "workspace_audit_events_workspace_event_type_idx"
  ON "workspace_audit_events"("workspace_id", "event_type");
CREATE INDEX "workspace_audit_events_entity_idx"
  ON "workspace_audit_events"("primary_entity_kind", "primary_entity_id");
CREATE INDEX "workspace_audit_events_correlation_id_idx"
  ON "workspace_audit_events"("correlation_id");

ALTER TABLE "workspace_audit_chain_heads"
  ADD CONSTRAINT "workspace_audit_chain_heads_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_audit_events"
  ADD CONSTRAINT "workspace_audit_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION tasktwin_block_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_EVENT_IMMUTABLE'
    USING ERRCODE = 'P0001',
          HINT = 'workspace_audit_events is append-only. Database administrators must disable this trigger before modifying the table.';
END;
$$;

CREATE TRIGGER "workspace_audit_events_block_update"
  BEFORE UPDATE ON "workspace_audit_events"
  FOR EACH ROW
  EXECUTE FUNCTION tasktwin_block_audit_mutation();

CREATE TRIGGER "workspace_audit_events_block_delete"
  BEFORE DELETE ON "workspace_audit_events"
  FOR EACH ROW
  EXECUTE FUNCTION tasktwin_block_audit_mutation();

CREATE TRIGGER "workspace_audit_events_block_truncate"
  BEFORE TRUNCATE ON "workspace_audit_events"
  FOR EACH STATEMENT
  EXECUTE FUNCTION tasktwin_block_audit_mutation();

COMMENT ON TRIGGER "workspace_audit_events_block_update" ON "workspace_audit_events"
  IS 'Append-only enforcement. A privileged role may DROP or DISABLE this trigger.';
COMMENT ON TRIGGER "workspace_audit_events_block_delete" ON "workspace_audit_events"
  IS 'Append-only enforcement. A privileged role may DROP or DISABLE this trigger.';
COMMENT ON TRIGGER "workspace_audit_events_block_truncate" ON "workspace_audit_events"
  IS 'Append-only enforcement. A privileged role may DROP or DISABLE this trigger.';
COMMENT ON FUNCTION tasktwin_block_audit_mutation()
  IS 'Raises AUDIT_EVENT_IMMUTABLE to prevent UPDATE/DELETE/TRUNCATE on workspace_audit_events. Privileged roles may REPLACE this function.';

INSERT INTO "workspace_audit_chain_heads" ("workspace_id")
SELECT "id" FROM "workspaces"
ON CONFLICT ("workspace_id") DO NOTHING;