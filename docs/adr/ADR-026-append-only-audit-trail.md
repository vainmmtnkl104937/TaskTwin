# ADR-026: Append-Only Audit Trail with Hash-Chained Verification

## Status

Accepted.

## Context

TaskTwin controls actions that mutate workflows, policies, runs, approvals and
locator repairs. Operators and auditors must answer three questions for every
mutation: who acted, on what entity, and against what policy snapshot. Existing
domain tables log partial information but do not provide a tamper-evident,
queryable history that spans all of these modules. Sensitive inputs, runtime
outputs and execution data must never leak into this history.

## Decision

TaskTwin introduces a workspace-scoped, append-only audit trail. Every state
mutating domain action emits one typed event inside the same database
transaction that performs the mutation. The trail is recorded as a
hash-chained sequence of immutable rows; deletions and updates are rejected by
PostgreSQL triggers and application rules. A canonical-JSON + SHA-256 chain
makes tampering detectable without a separate signature infrastructure.

Events are organised by primary entity (`workflow`, `workflow_version`,
`policy_version`, `workflow_run`, `approval_request`, `repair_request`,
`locator_repair_proposal`) and a typed payload that is validated by a per-event
zod schema. Payloads must never carry observed/expected values, secrets,
tokens, URLs, locators, screenshots or any other value forbidden by the shared
`FORBIDDEN_AUDIT_KEYS` list. Run evidence returns a typed subset of safe
execution events.

Chain verification re-hashes the chain from the first recorded event through
the latest head, returning `ok`, `sequence_gap`, or `tampered` with the
sequence and failure kind for the first invalid event. Source IDs are
server-derived; conflicts produce HTTP 409 (`AUDIT_SOURCE_CONFLICT`). The
audit appender is invoked inside the existing domain transactions; no
in-memory mutexes are introduced.

## Consequences

* Every domain mutation must accept a Prisma transaction handle so the appender
  can persist the event atomically.
* Read APIs and UI components must never expose forbidden payload keys.
* Verification is computed at request time; there is no separate signature
  service to operate.
* The audit trail does not replace domain-level access control; the existing
  guards still own authorization.
* Long-term archival, external SIEM forwarding and granular per-actor
  retention are explicitly out of scope for this session.