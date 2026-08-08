# Session 28 — Privacy-safe Operational Telemetry

Session 28 introduces deterministic component health, fixed-window Workspace operational summaries and the Workspace Operations Dashboard.

## Health and heartbeat

The API exposes `/health/live` without a database dependency and `/health/ready` with a lightweight PostgreSQL/configuration check. API, enabled Scheduler and Notification Worker processes report every approximately 30 seconds with a random boot identifier. No hostname, IP address, OS username, path, environment or credential is stored. Graceful shutdown marks a stopped timestamp; a crash is represented by freshness ageing from healthy to degraded to unavailable.

Heartbeat writes and health/metrics reads do not create audit events or operational alerts.

## Workspace metrics

`GET /workspaces/:workspaceId/operations/overview` accepts only `1h`, `24h`, `7d` or `30d`. It uses one database timestamp and direct aggregate queries over WorkflowRun, RunnerDevice, Approval, Repair, Schedule/Occurrence, alert/outbox and audit-head state. No audit payload or WorkflowDefinition JSON is scanned.

Run success and failure rates use succeeded, failed, timed-out and interrupted outcomes as the denominator. Cancelled runs are reported but do not count as business failures. An empty denominator produces `null`.

## Audit integrity

The latest authoritative audit verification result is persisted without event payloads or hashes. An invalid result is authoritative. A valid result is authoritative only when the complete chain through the current head was checked; a newer chain head changes the dashboard state to `not_verified` until another full verification.

## Web

`/workspaces/:workspaceId/operations` renders safe health cards, Runner availability, run rates, pending work, Schedule and Notification state, Audit integrity and an accessible run-outcome table. Window navigation is fixed and all links target existing authorized list pages.

## Current limits

This session does not add Prometheus, Grafana, OpenTelemetry, distributed tracing, external APM, public metrics, business analytics, user-defined windows, autoscaling or infrastructure auto-alerting.
