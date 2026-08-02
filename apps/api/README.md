# TaskTwin control-plane API

## Workflow output metadata

Run creation initializes one metadata-only output row per Extract step.
Sequenced progress can mark an output produced, and completion reconciles the
safe summary against the stored workflow definition. API contracts never accept
or return an extracted value, length, hash, locator, or source URL.
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

Session 13 adds authenticated, membership-scoped lifecycle endpoints:

- `GET /workflows/:workflowId/versions`
- `POST /workflow-versions/:versionId/submit-for-testing`
- `POST /workflow-versions/:versionId/return-to-draft`
- `POST /workflow-versions/:versionId/publish`
- `POST /workflow-versions/:versionId/archive`
- `POST /workflows/:workflowId/versions`

Submit, return, and publish use expected Draft revision checks where
applicable. Only OWNER and ADMIN can publish or archive. Creation requires a
caller-generated UUID `clientCreationId` and a Published or Archived
`sourceVersionId`.

```powershell
pnpm workflow-lifecycle:check
```

Session 14 adds public pairing creation/polling, authenticated Workspace
approval and runner management, separate runner authentication, and heartbeat:

- `POST /runner-pairing/sessions`
- `POST /runner-pairing/token`
- `POST /runner-pairing/inspect`
- `POST /workspaces/:workspaceId/runner-pairing/approve`
- `POST /runner-pairing/deny`
- `GET /workspaces/:workspaceId/runner-devices`
- `POST /runner-devices/:runnerDeviceId/revoke`
- `POST /runner/heartbeat`

Runner heartbeat uses
`TaskTwinRunner <runnerDeviceId>.<credential>`, never the user JWT. Pairing
codes, credentials, and complete Authorization headers must not be logged.
Production verification and runner origins require HTTPS; loopback HTTP is
development-only.

Session 17 adds membership-scoped run creation/read/cancellation and
runner-authenticated claim, lease, progress and completion endpoints. Run
creation accepts only a client run ID and same-Workspace Runner selection;
allowed origins and timeout policy are server-owned. Runner job mutations also
require `X-TaskTwin-Run-Lease`. Only its keyed hash is persisted.

```powershell
pnpm workflow-runs:check
```

Session 18 adds runner-authenticated public-key registration and
user-authenticated secure run preparation/commit:

- `POST /runner/encryption-keys`
- `POST /workflow-versions/:workflowVersionId/run-preparations`
- `POST /run-preparations/:preparationId/commit`

The API verifies public-key fingerprints and exact AAD/ciphertext binding but
has no private key and never decrypts runtime variables. PostgreSQL stores safe
manifests, public keys and encrypted envelopes only.

Session 21 adds runner-authenticated approval creation/status endpoints and
user-authenticated Workspace approval APIs. Request metadata is derived from
the immutable Published WorkflowVersion. OWNER and ADMIN may approve or reject;
MEMBER and VIEWER remain read-only. Decisions require `clientDecisionId` and
use atomic first-terminal-decision-wins semantics.

Session 22 adds runner-authenticated repair creation/status endpoints and
membership-scoped Repair Center endpoints. Runner calls require the assigned
device and current run lease. The server derives retry eligibility from the
Published workflow and deterministic recovery policy; it never accepts a
client-provided permission. OWNER/ADMIN may Retry, MEMBER may Abort, and exact
request/decision retries are idempotent.
