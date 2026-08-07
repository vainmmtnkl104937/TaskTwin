# @tasktwin/audit-trail

The `@tasktwin/audit-trail` package provides:

* The canonical event taxonomy (`AUDIT_EVENT_TYPES`).
* Typed payload schemas for every event family (`AUDIT_PAYLOAD_SCHEMAS`).
* Canonical-JSON serialisation for deterministic hashing.
* A SHA-256 hash-chain helper (`HashChainLink`, `verifyChain`).
* An `AuditAppender` that persists events inside a Prisma transaction and
  enforces immutability.
* A `verifyAuditChain` helper that re-hashes a stored range and reports
  tampering or gaps.

The package is framework- and transport-agnostic. The NestJS API wraps
`AuditAppender` and `verifyAuditChain`. The web layer never imports this
package directly; it consumes typed contracts from `@tasktwin/web`
contracts.

## Usage

```ts
import {
  AuditAppender,
  appendAuditEventTransactional,
  verifyAuditChain,
} from '@tasktwin/audit-trail';

await appendAuditEventTransactional(prisma, repository, {
  schemaVersion: 1,
  workspaceId,
  eventType: 'workflow.created',
  actor: { type: 'user', userId: user.id },
  primaryEntity: { kind: 'workflow', id: workflowId },
  payload: { schemaVersion: 1, workflowId, workflowName },
  sourceId: 'workflow-create',
});

const result = await verifyAuditChain({
  repository,
  workspaceId,
});
```

## Privacy

The package exposes a single `FORBIDDEN_PAYLOAD_KEYS` list. Application code
must never include these keys when constructing an event. The appender does
not strip them at write time — the schemas enforce the boundary at the type
level.

## Limitations

* The appender assumes a Prisma-backed store. Replacing the database
  requires implementing the `WorkspaceAuditTrailReader` interface.
* Hashing is SHA-256. Switching to a stronger algorithm requires a
  migration strategy to preserve chain integrity.
# Notification events

The strict event registry includes `notification.alert.created`, `notification.alert.resolved` and `notification.delivery.dead_lettered`. Payloads are limited to alert ID/type/severity, source type/ID and recipient count. Polling, retries, bell reads and mark-read operations are intentionally not audited.
