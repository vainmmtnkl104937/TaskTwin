# Notification worker

Dedicated non-HTTP process for the in-app notification outbox. It claims bounded batches with PostgreSQL `FOR UPDATE SKIP LOCKED`, uses database time and a 30-second lease, retries at 15/60/300/900 seconds, and dead-letters after at most five attempts. Delivery and outbox completion share one transaction and `UserNotification` has a unique alert/recipient identity.

Run with `pnpm --filter @tasktwin/notification-worker start`. External channels, preferences, escalation and manual replay are intentionally unsupported.

Each worker boot also reports a privacy-safe `notification_worker` heartbeat approximately every 30 seconds. The persisted boot UUID is random and is not a hostname or infrastructure identity. SIGINT/SIGTERM stops new claims, lets the current cycle finish, records graceful stop when possible and disconnects. A hard crash leaves the row unstopped so database-time freshness can transition it from healthy to degraded to unavailable. Heartbeats never create audit events or notifications.
