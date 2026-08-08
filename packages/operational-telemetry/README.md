# `@tasktwin/operational-telemetry`

Framework-independent contracts and deterministic logic for TaskTwin operational health and Workspace-scoped metric snapshots.

The package depends only on Zod. It does not know about NestJS, Prisma, React, PostgreSQL, Playwright, infrastructure identity or external observability providers.

It defines fixed metric windows, heartbeat freshness, safe rate semantics, strict snapshot schemas and privacy guards. A zero rate denominator produces `null`; arbitrary windows and unexpected snapshot fields are rejected.
