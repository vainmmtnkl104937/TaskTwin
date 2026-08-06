# Audit Triggers

The `workspace_audit_events` table is protected by PostgreSQL triggers in
addition to application-level guarantees. This document explains the
behaviour, intent and operational considerations of those triggers.

## Triggers

### `workspace_audit_events_no_modify`

BEFORE `UPDATE` or `DELETE` on `workspace_audit_events`, raise an
exception. The exception message is recorded in `pg_exception_details`
and surfaces as `AUDIT_STORAGE_FAILURE` in the API.

### `workspace_audit_chain_heads_no_modify`

Same enforcement on `workspace_audit_chain_heads` (the per-workspace
chain head). Updating the head is only permitted by the appender inside
the same transaction that wrote the new event.

## Rationale

* Defence in depth. Application code should never issue
  `UPDATE`/`DELETE` on these tables, but the trigger is the last line of
  defence against a buggy migration or a hand-crafted SQL statement.
* Forensic certainty. An auditor who can verify the chain today can be
  confident that no row has been altered since it was written.

## Operational Considerations

* Triggers add a small overhead on every append (~0.1 ms in benchmarks).
* Migration tooling must disable triggers temporarily; the migration
  scripts comment any such step explicitly.
* Backup restore replays the trigger logs. The chain must be re-verified
  after any point-in-time recovery.

## Verification Cadence

The API exposes `POST /workspaces/:workspaceId/audit-trail/verify` which
re-hashes the chain from the first recorded event through the latest
head. The web UI exposes a one-click "Verify audit chain" button. A
scheduled verification job is out of scope for this session.