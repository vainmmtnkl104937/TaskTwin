# ADR-012: draft workflow editing and optimistic concurrency

- Status: Accepted
- Date: 2026-07-29

## Context

TaskTwin now creates deterministic version 1 draft workflows from completed
recordings. A review UI needs to make bounded corrections without weakening
tenant isolation, secret handling, published-version immutability, or the
ordered workflow contract. Two browser tabs can edit the same draft, so a
last-write-wins update could silently lose reviewed work.

## Decision

Pure editor transformations live in the framework-independent
`@tasktwin/workflow-editor-core` package. They return new objects, accept
caller-generated IDs, and treat `WorkflowDefinition.steps` order as execution
order. React Flow is only a deterministic visualization and selection surface.

`WorkflowVersion` receives a positive `revision` counter starting at 1.
`PATCH /workflow-versions/:id/draft` requires `expectedRevision` and the
complete definition. The persistence transaction:

1. Resolves the row through current organization membership.
2. Requires DRAFT status and a writer role.
3. Validates schema and immutable identity/version/status fields.
4. Updates only when the stored revision equals `expectedRevision`.
5. Atomically increments revision.
6. Synchronizes Workflow name and description in the same transaction.

A stale revision returns HTTP 409 with
`WORKFLOW_DRAFT_REVISION_CONFLICT`. Neither the server nor web client merges or
overwrites silently. The client retains its local draft for manual recovery.

Authentication remains at a Next.js server boundary. The short-lived API token
is held in an HTTP-only cookie and is not exposed to client JavaScript.

## Consequences

- Concurrent edits cannot silently overwrite each other.
- Workflow version and mutable draft revision are explicitly separate.
- VIEWER can review but cannot mutate.
- The client must reload and manually reconcile after a conflict.
- This decision adds no collaboration, presence, auto-save, undo history,
  publish transition, version creation, locator editing, or execution.
