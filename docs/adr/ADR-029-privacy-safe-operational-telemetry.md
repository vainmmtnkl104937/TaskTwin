# ADR-029: Privacy-safe operational telemetry

Status: Accepted — Session 28 (2026-08-08)

## Decision

TaskTwin records a minimal database heartbeat for the Control Plane API, Scheduler and Notification Worker. Each process uses a random boot UUID and stores only component type, start time, latest heartbeat time and optional graceful-stop time. Infrastructure identity is deliberately absent.

Health freshness is deterministic: at most 90 seconds is healthy, more than 90 through 180 seconds is degraded, more than 180 seconds is unavailable, and no known heartbeat is unknown. One fresh unstopped instance satisfies a component. PostgreSQL time is authoritative at persistence and snapshot boundaries.

Workspace operational metrics are calculated on demand from structured domain columns through fixed 1h, 24h, 7d and 30d windows. The authenticated route and every domain query bind one Workspace. Rates exclude user-cancelled runs from the failure denominator and return `null` when no eligible terminal outcome exists.

## Safety boundary

Operational snapshots contain only enums, bounded counts, rates, durations and safe timestamps. Runtime inputs, secrets, outputs, locators, URLs, browser errors, workflow definitions, audit payloads and infrastructure identifiers are not telemetry. Workspace and runtime entity identifiers are not exposed as metric labels.

Liveness is an in-process HTTP response and never queries PostgreSQL. Readiness performs only a lightweight database probe and existing configuration validation, returning stable codes rather than raw errors or configuration values. Heartbeats and metrics reads are not audit events.

## Consequences

The Operations Dashboard is a pull-based product view, not an external monitoring system. PostgreSQL failure makes readiness fail and prevents heartbeat persistence and metric reads, while liveness can remain available. Heartbeat state is eventually consistent and does not detect every event-loop stall. There is no public Prometheus endpoint, distributed tracing, external APM, infrastructure alerting or heartbeat-retention job in this session.
