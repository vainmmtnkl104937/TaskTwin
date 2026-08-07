# ADR-028: Transactional notification outbox

Status: Accepted — Session 27 (2026-08-08)

## Decision

Operational alerts are durable domain records. A trusted API-layer appender validates a strict versioned contract, derives severity/lifecycle, resolves current recipients from the Workspace's organization membership, creates one idempotent in-app outbox message per recipient, and appends the alert audit event using the source transaction client. Any required failure rolls back the domain mutation.

Notification delivery is outside that transaction. A dedicated worker claims bounded batches with PostgreSQL row locks and `SKIP LOCKED`, database time, and expiring leases. Delivery is at least once; the unique `(alert, recipient)` UserNotification identity makes in-app effects idempotent. Retrying uses 15, 60, 300 and 900 second delays with no more than five claims. Permanent failures, exhausted attempts, and an expired fifth lease enter dead letter and create one audit event.

## Safety boundary

Templates are a closed discriminated v1 union. Parameters contain only stable IDs, safe enums, bounded counts and timestamps. Actions are typed entities, never URLs. Runtime inputs, aliases/secrets, outputs, locators, verification values, full URLs, browser errors, DOM/HTML, screenshots, ciphertext, credentials and tokens are prohibited.

## Consequences

Commit means an alert and its delivery intents are durable, not that a user has seen them. Delivery may be delayed or repeated internally after a crash. There is no exactly-once visibility guarantee across database restoration. Session 27 supports in-app delivery only; preferences, reminders, escalation, external channels and manual dead-letter replay remain absent.
