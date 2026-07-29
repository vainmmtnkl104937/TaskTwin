# Session 03: Control-plane database foundation

## Goal

Establish a minimal PostgreSQL and Prisma persistence foundation for versioned
workflow definitions while preserving TaskTwin's control-plane versus local
execution boundary.

## Included

- Local PostgreSQL 17.10 service through Docker Compose
- Required environment-based credentials, configurable host port, named data
  volume, and readiness health check
- Framework-independent `@tasktwin/database` package
- Prisma 7 configuration and generated client
- First migration containing only `Workflow` and `WorkflowVersion`
- Unique workflow-version revisions, lifecycle index, and cascade relation
- Workflow-schema validation before persistence
- NestJS database dependency injection and Prisma lifecycle handling
- `GET /health/database` without changing `GET /health`
- Mocked default tests and explicit real database integration verification

## Persistence boundary

The repository accepts `unknown`, parses it with the Session 02
`WorkflowDefinitionSchema`, and only then starts a transaction. Invalid or
unexpected workflow JSON cannot reach Prisma through this boundary. Secret
sources remain references only because the shared schema rejects an actual
secret-value property.

Creating a version also creates or updates its parent workflow's descriptive
metadata. The version insert is append-only: no update method is exposed, and
the database rejects a duplicate `(workflowId, version)`.

## Database readiness

`GET /health/database` performs a minimal `SELECT 1` probe:

- HTTP 200 returns `{"service":"tasktwin-database","status":"healthy"}`.
- HTTP 503 returns only
  `{"service":"tasktwin-database","status":"unhealthy"}`.

The response never includes a database URL, password, host error, SQL text, or
driver details. The API can start when PostgreSQL is temporarily unavailable so
the readiness endpoint can report that state, but `DATABASE_URL` itself is
required and validated at startup. `API_PORT` is optional, defaults to `3001`,
and must be an integer from 1 through 65535.

## Development operations

Create a real, ignored `.env` from `.env.example`, replace the placeholder
password, and run:

```shell
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm db:status
pnpm db:check
```

Normal `pnpm test` is database-independent. `pnpm db:check` is intentionally
opt-in and fails rather than skipping when the database is absent or migrations
are not applied.

`pnpm db:down` stops PostgreSQL and retains the named volume.

> **Destructive development command:** `pnpm db:reset` removes all data in the
> database identified by `DATABASE_URL`, then reapplies migrations. It refuses
> non-loopback database hosts and requires
> `TASKTWIN_ALLOW_DATABASE_RESET=true` as an explicit confirmation. Verify that
> the URL targets a disposable local database before running it. It is not a
> production operation.

## Excluded

- Workflow HTTP CRUD and web UI behavior
- Authentication, users, organizations, and workspaces
- PostgreSQL models other than Workflow and WorkflowVersion
- Recording, pairing, workflow execution, Playwright, and locator resolution
- Redis, BullMQ, AI, policy execution, and workflow repair
- Secret storage
- Seed data beyond reusable test fixtures
- Application Docker images, cloud deployment, and production migration
  automation

## Current limitations

- The persistence repository is not exposed through an API endpoint.
- Workflow references and locator semantics are not resolved before storage.
- There is no authorization or retention policy for future deletion.
- Database connection pooling uses adapter defaults except for a bounded
  connection timeout.
- Local Compose configuration is development-only and is not production
  hardening.
