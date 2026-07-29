# Session 09: Durable recording artifacts and control-plane sync

## Goal

Session 09 turns a stopped privacy-aware recorder timeline into an immutable
local artifact and defines an authenticated, workspace-scoped protocol for
persisting that artifact in the control plane.

## Included

- Framework-independent `@tasktwin/recording-schema`
- Strict current recording-event, artifact, batch, completion, and safe
  response contracts
- Full artifact validation, deterministic privacy summaries, and contiguous
  sequence validation
- Durable `chrome.storage.local` archive and local sync outbox
- Explicit artifact, archive, aggregate, and pending-outbox limits
- A transport abstraction and mock transport orchestration
- `RecordingSession`, `RecordingEvent`, and `RecordingSyncBatch` Prisma models
- Authenticated create, batch, complete, and safe metadata API endpoints
- Workspace membership and organization-role enforcement
- Application- and database-backed idempotency
- Transactional batch ingestion and completion-time sequence verification

## Local finalization

Active recorder state and the active timeline remain in
`chrome.storage.session`. They are temporary working state owned by the service
worker.

Stop follows this order:

1. Flush debounced input and wait for in-flight candidates.
2. Persist `stopping` so new events are rejected.
3. Validate the complete current timeline.
4. Build and validate `RecordingArtifact` version 1.
5. Persist the artifact in the local archive.
6. Create or preserve its local outbox entry.
7. Return the recorder to idle and report success.

The durable archive and outbox use separate versioned keys in
`chrome.storage.local`. The archive write is read-confirmed before TaskTwin
creates the outbox entry. If the second phase fails, the artifact remains and
an exact retry repairs the missing outbox entry idempotently. A different
artifact with the same client session ID is a conflict and is never
overwritten.

## Local limits and recovery

Session 09 initially allows at most 20 retained artifacts, 4 MiB for one
serialized artifact, 20 non-synced outbox entries, and 8 MiB for the serialized
archive document. The strict outbox is independently bounded to 20 entries.
Reaching a limit returns a fixed safe error. TaskTwin does not silently trim an
artifact or evict an unsynced recording.

The active timeline remains available after a finalization error. Until archive
management UI exists, development recovery is explicit: export or sync records
that must be retained, remove only a chosen record through extension DevTools,
and retry or explicitly reset the recorder. Reset is a deliberate discard, not
automatic recovery.

## Outbox and delivery

Outbox states are `pending`, `syncing`, `synced`, and `failed`. Entries contain
only recording identifiers, attempt metadata, timestamps, and fixed error
codes. They do not contain access tokens or copy the artifact.

The transport port mirrors create, batch, and complete operations. Tests use a
mock transport. Session 09 does not wire a production HTTP transport, store
extension credentials, or schedule background retries.

Delivery semantics are at least once. Deterministic batch IDs and server-side
idempotency make exact retries safe:

- `clientSessionId` protects session creation.
- `clientBatchId` protects batch receipt.
- client event ID and sequence uniqueness protect event insertion.

## Server persistence and completion

The API never treats JSONB as validation. Shared Zod schemas validate metadata,
every event, and each batch before writes. The event boundary independently
classifies allowlisted target metadata, rejects a declared sensitivity or
policy that weakens that result, and rejects recognized hard-sensitive
literals in allowed payloads. Personal literals require an explicit
personal/allow decision; the extension setting remains mask by default. Batch
receipt, event rows, and received counters are committed in one serializable
database transaction.

Completion loads events in sequence order and reconstructs the artifact. A
non-empty recording must start at sequence 1, contain no gaps, and end at its
declared last sequence. An empty recording uses count and last sequence zero.
Privacy summary and origin/session membership are recomputed rather than
trusted. Only then may a receiving session become completed.

The metadata endpoint returns allowlisted session information and privacy
counts. It does not return raw event JSON, values, targets, or locators.

## Authorization

All recording endpoints require the existing short-lived JWT. Resource
resolution joins through Workspace, Organization, and OrganizationMember.
Cross-organization resources are not exposed.

- OWNER, ADMIN, MEMBER: create, batch upload, complete, and metadata read.
- VIEWER: metadata read only.

The JWT still contains only `sub`; roles and workspace permissions are loaded
from current database state.

## Excluded

- Extension login, OAuth, PKCE, or token storage
- Production extension HTTP sync or automatic retry scheduling
- Recording review/editor UI or Next.js dashboard
- Raw-event browsing endpoints
- Workflow-step generation or workflow conversion
- Screenshots, screenshot upload, OCR, or encryption-key management
- Redis, BullMQ, AI, Playwright, and cloud deployment

## Current limitations

- Sync orchestration uses a mock transport only; no extension request reaches
  the API in production.
- Local artifacts are quota-bounded browser data, not an encrypted archive, and
  there is no archive-management UI or automatic retry scheduler.
- Legacy v1/v2 timelines remain summary-only and cannot be finalized because
  they lack the current locator/privacy guarantees.
- Server-side privacy defense is deterministic and bounded to allowlisted
  target metadata plus known literal patterns. It deliberately does not inspect
  arbitrary page content or use probabilistic/AI classification.
