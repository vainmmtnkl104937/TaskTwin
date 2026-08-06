# Session 25: Append-Only Audit Trail

Session 25 introduces a tamper-evident, workspace-scoped audit trail that
records every state-mutating domain action. The trail uses canonical JSON and
SHA-256 hash chaining, is enforced by PostgreSQL triggers, and is exposed
through the API and web UI.

## Scope

* `packages/audit-trail` — append-only event types, canonicalisation,
  hashing, appender, verification, payload schemas, actor and entity
  references, and a single `verifyAuditChain` helper used by the API.
* `packages/database` — `workspace_audit_events` and
  `workspace_audit_chain_heads` tables, immutability triggers,
  `WorkspaceAuditTrailRepository` (read), `AuditAppenderRepository`
  (append).
* `apps/api` — `AuditTrailModule`, controller, service, response mapper and
  contracts. Endpoints:
  * `GET /workspaces/:workspaceId/audit-events`
  * `GET /audit-events/:auditEventId`
  * `POST /workspaces/:workspaceId/audit-trail/verify`
  * `GET /workflow-runs/:workflowRunId/evidence`
* `apps/web` — list, detail and verify pages, a typed `Evidence` tab on the
  run detail page, audit link in workspace navigation, typed
  per-event-family components.
* Domain integrations — workflow lifecycle, policy, run lifecycle, approval,
  repair, locator repair and run evidence all append events in the same
  transaction as the mutation.

## Decisions

* Audit events are typed and validated by per-event-family zod schemas. The
  `SafeAuditPayloadSchema` rejects a shared forbidden key set at every
  control-plane boundary (value, text, input, secret, token, password,
  ciphertext, wrappedKey, iv, aad, locator, selector, url, href, query,
  fragment, dom, html, screenshot, stackTrace, expectedValue, observedValue,
  expected, observed, rawError, stack, email, userAgent, ip, username,
  hostname, outputLength, outputHash).
* `sourceId` is server-derived from the module + operation + client
  identifier, deduped per workspace by the appender; collisions surface as
  `AUDIT_SOURCE_CONFLICT` (HTTP 409).
* Append-only enforcement is dual: the application refuses updates/deletes
  through repository wrappers and a PostgreSQL trigger raises an exception
  for any `UPDATE` or `DELETE` against `workspace_audit_events`.
* Verification is computed on demand from the persisted chain. There is no
  scheduled re-hash and no external signature service.
* `RUN_EVIDENCE_EVENT_TYPES` selects only `workflow_run.*` events for the
  safe evidence endpoint. Execution attempts, outputs and verifications do
  not appear.

## Follow-Ups

* External SIEM forwarding and long-term archival.
* Per-actor retention windows and legal hold.
* Out-of-band signing key (HSM-backed) if stronger tamper resistance is
  required.
* Compression of large payloads (>32 KiB) into a separate object store.

## Files Added or Modified (high level)

* `packages/audit-trail/*`
* `packages/database/src/audit-trail/*`
* `packages/database/prisma/migrations/20260805120000_workspace_audit_trail/`
* `apps/api/src/audit-trail/*`
* `apps/api/test/audit-trail.integration.spec.ts`
* `apps/web/app/(authenticated)/workspaces/[workspaceId]/audit/*`
* `apps/web/components/audit-trail/*`
* `apps/web/components/workflow-runs/run-evidence-list.tsx`
* `apps/web/lib/server/control-plane.ts`
* `apps/web/lib/control-plane-contracts.ts`
* `apps/web/test/audit-trail.spec.tsx`
* `apps/web/test/run-evidence.spec.tsx`
* `docs/audit-trail.md`
* `docs/run-evidence.md`
* `docs/audit-triggers.md`
* `docs/adr/ADR-026-append-only-audit-trail.md`
* `packages/audit-trail/README.md`