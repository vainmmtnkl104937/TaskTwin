# Notification worker

Dedicated non-HTTP process for the in-app notification outbox. It claims bounded batches with PostgreSQL `FOR UPDATE SKIP LOCKED`, uses database time and a 30-second lease, retries at 15/60/300/900 seconds, and dead-letters after at most five attempts. Delivery and outbox completion share one transaction and `UserNotification` has a unique alert/recipient identity.

Run with `pnpm --filter @tasktwin/notification-worker start`. External channels, preferences, escalation and manual replay are intentionally unsupported.
