# ADR-004: Use PostgreSQL and Prisma for control-plane workflow persistence

- Status: Accepted
- Date: 2026-07-29

## Context

TaskTwin needs durable, versioned workflow definitions in its control plane.
Workflow data crosses process and storage boundaries, so compile-time
TypeScript types cannot guarantee that persisted JSON conforms to the shared
workflow contract. Published workflow revisions must not be silently changed.

Browser execution remains local and does not need direct database access.
Session 03 needs a reproducible development database without introducing cloud
deployment, application containers, or unrelated business models.

## Decision

TaskTwin will use PostgreSQL for control-plane persistence and Prisma 7 through
the framework-independent `@tasktwin/database` package.

The Prisma schema contains only:

- `Workflow`, the stable workflow identity and descriptive metadata.
- `WorkflowVersion`, an immutable revision with lifecycle status, schema
  version, and the validated definition in `JSONB`.

The pair `(workflowId, version)` is unique. Lifecycle status is indexed. A
workflow owns its versions through a foreign key with `ON DELETE CASCADE`.
Cascade behavior keeps explicit deletion relationally consistent, although
Session 03 exposes no deletion or other CRUD endpoint.

The persistence repository validates unknown definition input with
`WorkflowDefinitionSchema` before opening a database transaction. It offers a
create operation and no update operation for versions. Positive version and
exact schema-version rules remain at this application boundary rather than
being duplicated as database check constraints.

Prisma 7 configuration lives in `prisma.config.ts`. The Prisma schema declares
only the PostgreSQL provider; the connection URL comes from configuration.
Runtime connections use the PostgreSQL driver adapter required by Prisma 7.
Generated client source uses an explicit package-local output and is not
committed.

Docker Compose runs only PostgreSQL for local development. Credentials are
required through environment variables, data uses a named volume, and a
`pg_isready` health check gates dependent verification.

## Consequences

API-specific dependency injection stays in `apps/api`; the database package can
be tested and consumed without NestJS. The local runner and extension remain
outside the control-plane persistence boundary.

Normal tests use mocks and do not require Docker. A separate opt-in integration
test proves a real connection and verifies that at least one migration has been
applied. Missing database configuration is an explicit failure for database
commands and API startup, not a silently skipped check.

PostgreSQL, Prisma Client, the Prisma PostgreSQL adapter, and `pg` become current
dependencies. The generated client must run before package compilation.

The JSON column does not replace runtime validation, does not implement workflow
CRUD, and does not resolve semantic references inside a workflow. Authentication,
authorization, policy, secret storage, and production database operations remain
future work.
