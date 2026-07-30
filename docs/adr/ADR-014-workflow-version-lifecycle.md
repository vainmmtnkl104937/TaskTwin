# ADR-014: Workflow version and publish lifecycle

## Status

Accepted for Session 13.

## Context

Draft revision concurrency protects editing, but it does not define when a
workflow is ready for review, which version is current, or how published
content remains immutable. Lifecycle state must be shared across the editor,
API, and persistence layer without coupling deterministic domain decisions to
a framework.

## Decision

TaskTwin uses `@tasktwin/workflow-lifecycle` for pure transition validation,
publish-readiness analysis, safe lifecycle issues, summaries, and immutable
Draft cloning. The only direct transitions are:

- Draft to Testing;
- Testing to Draft;
- Testing to Published; and
- Published to Archived.

Publishing requires Testing, fresh server-side readiness validation, and an
OWNER or ADMIN role. The `WorkflowVersion` persistence envelope is the
authoritative lifecycle state. Transitions change status and audit metadata
only; they do not rewrite definition content or increment revision.

A future edit is a new Draft cloned from a Published or Archived source. It
preserves variables, steps, and step IDs; receives the next version number and
revision 1; and records its source plus an idempotency key.

Publish and version allocation run in serializable transactions after locking
the parent Workflow row. Publishing archives the current Published record and
publishes the candidate atomically. A PostgreSQL partial unique index provides
the final guarantee that each Workflow has at most one Published version.

## Consequences

- Version history is preserved without mutating published definitions.
- Readiness warnings remain visible while blocking issues stop transitions.
- Database concurrency, not process-local locking, protects multiple API
  instances.
- Raw SQL migration is required for the PostgreSQL partial unique index because
  Prisma schema syntax does not express it.
- Testing currently means read-only review readiness; it does not execute a
  browser workflow.
- Version diffing, rollback, deployment, execution, and branching remain
  separate decisions.
