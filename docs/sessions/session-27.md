# Session 27 — Operational Alerts and Notification Outbox

Session 27 adds closed operational alert contracts, transactional alert/outbox persistence, asynchronous in-app delivery, a personal inbox and unread count.

Supported alerts are approval required, repair required, run failed/timed out/interrupted, schedule auto-paused and audit integrity failed. Severity and lifecycle are derived by trusted code. Approval, repair and schedule alerts are active until their source is resolved; terminal run alerts are informational; audit integrity failures are critical and active.

Recipients are selected inside the alert transaction from active users who currently belong to the Workspace organization. Approval, repair and audit alerts route to OWNER/ADMIN. Run terminal alerts additionally route to the run creator; schedule auto-pause additionally routes to the schedule creator. A set removes duplicates.

The worker uses database time, `FOR UPDATE SKIP LOCKED`, bounded batches and a 30-second lease. Expired leases are reclaimable by another worker. In-app insertion and marking the outbox delivered are atomic and idempotent. Retry and dead-letter behavior follows [ADR-028](../adr/ADR-028-transactional-notification-outbox.md).

API endpoints:

- `GET /me/notifications`
- `GET /me/notifications/unread-count`
- `POST /me/notifications/:notificationId/read`
- `POST /me/notifications/read-all`

All endpoints use the authenticated user and never accept a recipient ID. The Web header exposes a recent-notification bell and `/notifications` provides unread/severity filters, action-required grouping and typed navigation.
