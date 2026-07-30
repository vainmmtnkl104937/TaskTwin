# Session 13: Workflow versioning and publish lifecycle

## Included

Session 13 adds:

- `@tasktwin/workflow-lifecycle` with deterministic transitions, readiness,
  typed issues, safe summaries, and immutable Draft cloning;
- the `testing` lifecycle state;
- WorkflowVersion provenance, idempotency, publish, and archive metadata;
- one-current-Published database enforcement;
- authenticated lifecycle and version-history API endpoints;
- role-aware history, badges, readiness, confirmation, and lifecycle controls
  in the web editor; and
- unit plus opt-in PostgreSQL/API integration coverage.

## Version and revision

Version identifies a preserved lineage record. Creating version 3 never
overwrites versions 1 or 2. Revision counts successful edits to the current
Draft and is checked optimistically on saves and review transitions. Moving
through Testing, Published, or Archived changes no definition content and does
not increment revision.

## Review and publication

Draft must pass deterministic readiness before entering Testing. Testing is
read-only and may return to Draft. Publish is allowed only from Testing, is
restricted to OWNER and ADMIN, and repeats readiness analysis against the
stored definition immediately before the transaction updates status.

Warnings are displayed but do not block. Unsupported schema versions, invalid
definitions, empty steps, duplicate step IDs, and blocking workflow-input
cross-reference issues prevent Testing or Publish. Issue messages do not
include literal or secret values.

Publishing locks the Workflow, archives its prior Published version, and
publishes the candidate in one serializable transaction. A partial unique
index guarantees that no Workflow has two current Published versions.

## New Draft creation

Published and Archived definitions remain immutable. OWNER, ADMIN, or MEMBER
can create a new Draft from either source. The pure clone preserves variables,
steps, and step IDs, changes definition version and status, and does not mutate
the source. Persistence allocates the next version under the Workflow lock,
sets revision 1, records `createdFromVersionId`, and deduplicates retries by
`clientCreationId`.

## Role permissions

| Action                     | OWNER | ADMIN | MEMBER | VIEWER |
| -------------------------- | ----- | ----- | ------ | ------ |
| Read history/version       | Yes   | Yes   | Yes    | Yes    |
| Edit Draft                 | Yes   | Yes   | Yes    | No     |
| Submit/return/create Draft | Yes   | Yes   | Yes    | No     |
| Publish/archive            | Yes   | Yes   | No     | No     |

All decisions use current database membership scoped through the version's
Workflow and Workspace, not mutable role data in the access token.

## Excluded

Testing does not execute the workflow. Session 13 does not add Local Runner,
Playwright, WorkflowRun, deployment, scheduled execution, version diffing,
automatic rollback, branching, multiple production versions, publish approval
workflows, AI review, or secret storage.
