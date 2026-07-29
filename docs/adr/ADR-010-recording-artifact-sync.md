# ADR-010: Finalize recordings locally before idempotent control-plane sync

## Status

Accepted for Session 09.

## Context

The Session 08 recorder owns a bounded, privacy-validated event timeline in the
Manifest V3 service worker. That timeline uses `chrome.storage.session`, which
survives popup closure and service-worker suspension but is not durable
recording history. The control plane also has no recording persistence or
protocol for receiving events safely.

A stopped recording must not depend on network availability. At the same time,
at-least-once delivery can repeat requests, so the server must not depend on
in-memory locks or assume that a request is delivered once.

## Decision

TaskTwin finalizes only the current privacy-aware timeline schema. Stop first
flushes pending input, prevents further capture, validates the complete
timeline, creates a versioned `RecordingArtifact`, and writes it to
`chrome.storage.local`. The artifact write is read-confirmed before a local
outbox entry is created. If the outbox write fails, the artifact is preserved
and an exact retry can finish the second phase. The recorder reports success
only after both durable local records exist.

Active state and the active timeline remain in `chrome.storage.session`.
Finalized artifacts and outbox state use strict versioned contracts in
`chrome.storage.local`. Local limits fail explicitly; TaskTwin does not evict
or overwrite an unsynced artifact.

`@tasktwin/recording-schema` is the framework-independent runtime source of
truth for current recording events, artifacts, upload batches, completion
requests, and safe responses. It depends on the existing locator and privacy
contracts, but not on Chrome, DOM, NestJS, Prisma, Playwright, or AI.

The control plane stores a receiving `RecordingSession`, validated
`RecordingEvent` rows, and processed `RecordingSyncBatch` receipts. Session
creation is idempotent by `clientSessionId`; batch delivery is idempotent by
`clientBatchId` within a session. Database unique constraints back application
checks. Batch receipt, event insertion, and counters commit in one serializable
transaction.

Completion reloads and runtime-validates stored events, reconstructs the
artifact, and verifies count, origin, privacy summary, and contiguous sequence
before changing the session to completed. A completed session rejects new
batches. Metadata reads never expose event JSON.

Event validation does not trust the privacy label supplied by a client. The
shared schema independently reclassifies bounded target metadata, rejects a
weaker declaration, and rejects recognized hard-sensitive literals from
allowed payloads before persistence.

Every API operation is authenticated and resolved through the current user's
organization membership. OWNER, ADMIN, and MEMBER may create, upload, and
complete; VIEWER may read safe metadata only.

## Consequences

- Recording remains local-first and does not fail merely because the API is
  unavailable.
- Delivery can be retried safely after ambiguous transport failures.
- Artifact, event, and protocol versions can evolve explicitly.
- Browser local storage is durable but not an encrypted vault and has a finite
  quota.
- Extension login, token storage, production HTTP transport, and automatic
  retry scheduling remain separate future decisions.
- Legacy timelines without current privacy decisions remain readable for a
  safe summary but are not silently upgraded into artifacts.
