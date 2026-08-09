# Audit Trail

The audit trail is an append-only, hash-chained history of every
state-mutating action taken inside a Workspace. It is intentionally
narrow: who acted, on what entity, what kind of change was made, and
whether the chain is still intact.

## Guarantees

- **Append-only.** PostgreSQL triggers reject `UPDATE` and `DELETE`
  statements against `workspace_audit_events`. Repository wrappers never
  expose mutating methods.
- **Hash-chained.** Each event embeds the SHA-256 hash of its canonical
  payload and the previous event's hash. Tampering with any column
  breaks verification.
- **Same-transaction.** The appender runs inside the same Prisma
  transaction as the domain mutation. Either the action and its audit
  event commit, or neither does.
- **Typed payloads.** Per-event-family zod schemas validate the payload.
  Any forbidden key (`value`, `text`, `secret`, `token`, `url`, …) is
  rejected before persistence.
- **Workspace-scoped.** All reads and writes are bounded by workspace.
  Cross-workspace reads return `404`.

## Read API

- `GET /workspaces/:workspaceId/audit-events` — paginated list with
  opaque cursor.
- `GET /audit-events/:auditEventId` — single typed event.
- `POST /workspaces/:workspaceId/audit-trail/verify` — chain
  verification (OWNER/ADMIN only).

Authorization:

| Endpoint          | OWNER | ADMIN | MEMBER | VIEWER |
| ----------------- | ----- | ----- | ------ | ------ |
| List audit events | ✔     | ✔     | ✔      | ✔      |
| Get audit event   | ✔     | ✔     | ✔      | ✔      |
| Verify chain      | ✔     | ✔     | ✖      | ✖      |
| Get run evidence  | ✔     | ✔     | ✔      | ✔      |

Cross-workspace access returns `404 AUDIT_EVENT_NOT_FOUND` to avoid
existence leaks.

## Privacy Boundary

The audit trail is a forensic record, not an execution log. Sensitive
inputs, runtime outputs, screenshots, locators, URLs and user identifiers
must not be embedded in payloads. The shared
`FORBIDDEN_AUDIT_KEYS` list enforces this at the schema level. The web
UI additionally re-validates responses against `SafeAuditPayloadSchema`
before rendering.

## Source Conflicts

Every event carries a server-derived `sourceId` keyed on the workspace.
The appender rejects duplicates with `AUDIT_SOURCE_CONFLICT` (HTTP 409).
Client retries must regenerate the source identifier or wait for the
original request to settle.

## Runner Secret Inventory

`runner.secret_inventory.updated` is emitted only when the Control Plane accepts a new monotonic inventory revision. Its strict payload contains Runner ID, previous/new revision, configured alias count, and the metadata-only inventory digest. It excludes aliases, secret values or value hashes, ciphertext, nonces, passphrases, master-key material, and local paths. Exact retries, status refreshes, and Runner startup do not create this event.

## Runner Runtime

`runner.runtime_mode.changed` and `runner.secret_protector.changed` are emitted
only when a Runner heartbeat changes accepted durable safe metadata. Payloads
contain Runner ID, mode/autonomy/service state or old/new unlock mode only.
Repeated identical heartbeats create no event. Protected native blobs, service
accounts, hostnames, instance identifiers, paths, aliases and secrets are
invalid payload fields. Local install/uninstall and local migration happen
outside the Control Plane trust boundary; central audit records only the state
later validated and accepted through the Runner protocol.

## Runner Software Version

`runner.software_version.changed` is emitted only when an accepted heartbeat
actually changes the persisted product version. Its strict payload contains the
Runner ID, previous/new product versions, run protocol and aggregate local-state
schema only. Exact repeated heartbeats and first complete metadata for the
already paired version create no event. Artifact paths, URLs, source commit,
host identity, vault metadata, signing keys and signatures are prohibited.
