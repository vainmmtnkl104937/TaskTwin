# TaskTwin control-plane API

Session 11 adds authenticated workflow reads and draft updates:

- `GET /workspaces/:workspaceId/workflows`
- `GET /workflow-versions/:workflowVersionId`
- `PATCH /workflow-versions/:workflowVersionId/draft`

All reads are membership-scoped. OWNER, ADMIN, MEMBER, and VIEWER can read;
VIEWER cannot PATCH. The PATCH body contains `expectedRevision` and the
complete version 1 `WorkflowDefinition`. Only DRAFT records can change.

A successful update increments revision and synchronizes Workflow name and
description in one serializable transaction. A stale revision returns HTTP 409
with `WORKFLOW_DRAFT_REVISION_CONFLICT`.

Before persistence, the PATCH boundary validates the complete workflow and
performs deterministic variable and secret-reference analysis. Blocking
cross-reference or compatibility issues return HTTP 400 with
`WORKFLOW_INPUT_VALIDATION_FAILED` and bounded structured issues. Error
responses do not contain runtime values or rejected secret-like strings.

Run the opt-in database E2E check with:

```powershell
pnpm db:up
pnpm db:migrate
pnpm --filter @tasktwin/api test:integration:workflow-editor
```
