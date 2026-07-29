# TaskTwin

TaskTwin is a local-first browser workflow automation product. Its intended
interaction is simple: **show a browser task once, review the generated plan,
then run the approved workflow safely**.

> Show it once. Review the plan. Run it safely.

This repository contains the application foundation, framework-independent
workflow domain model, and authenticated control-plane foundation created
through Session 04. It provides buildable application shells, shared
configuration and types, health checks, runtime workflow validation, local
PostgreSQL development tooling, short-lived access-token authentication, and
organization-scoped workspaces. It does not yet record or execute workflows.

## Browser-first MVP

The first product boundary is browser work initiated through a Chrome
extension and executed by a local runner. A control-plane API and web
application will eventually coordinate workflow metadata and review, while
browser interaction remains on the user's machine. Desktop automation and
general-purpose operating-system control are not part of the browser-first MVP.

## Workspaces

| Workspace                  | Current purpose                                          |
| -------------------------- | -------------------------------------------------------- |
| `apps/web`                 | Next.js landing page and web health indicator            |
| `apps/api`                 | NestJS health, authentication, and workspace endpoints   |
| `apps/extension`           | Manifest V3 popup shell with disabled recorder controls  |
| `apps/local-runner`        | Node.js startup and health/status shell                  |
| `packages/shared-types`    | Shared service health contract                           |
| `packages/workflow-schema` | Versioned workflow contracts and runtime validation      |
| `packages/database`        | Prisma client, identity, workspace, workflow persistence |
| `packages/config`          | Shared strict TypeScript and ESLint configuration        |

The architectural direction is documented in
[`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

## Requirements

- Node.js 22.13 or later within the Node 22 release line
- Corepack
- pnpm 10.34.5
- Docker Desktop or another Docker Engine with Compose for database development

Activate the pinned package manager and install all dependencies:

```shell
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm install
```

## Commands

```shell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

## Local database

Copy the environment template and replace its development-only password. The
real `.env` file is ignored by Git.

```powershell
Copy-Item .env.example .env
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm db:status
pnpm db:check
```

`pnpm db:up` waits for PostgreSQL to become healthy. `pnpm db:check` is an
explicit integration test that requires the database and applied migration;
normal `pnpm test` does not require Docker.

The API also requires `JWT_ACCESS_SECRET` (at least 32 characters).
`JWT_ACCESS_EXPIRES_IN` is an optional lifetime in seconds from 60 through
3600 and defaults to 900. To run the opt-in authentication/database e2e check:

```shell
pnpm auth:check
```

Useful development commands:

```shell
pnpm db:logs
pnpm db:down
```

`pnpm db:down` stops the container but keeps the named development volume.
`pnpm db:reset` is destructive: it deletes all data in the configured
development database and reapplies migrations. It refuses non-loopback hosts
and requires the explicit one-command confirmation
`TASKTWIN_ALLOW_DATABASE_RESET=true`. Run it only against a disposable local
database after checking `DATABASE_URL`.

Start individual applications after building as needed:

```shell
pnpm --filter @tasktwin/web dev
pnpm --filter @tasktwin/api dev
pnpm --filter @tasktwin/local-runner start
```

To inspect the extension, build it and load `apps/extension/dist` as an
unpacked extension in Chrome.

## Session 01 scope

Session 01 includes the monorepo toolchain, application shells, shared health
types, tests for the API and local runner, and foundational documentation. It
explicitly excludes authentication, databases, queues, browser recording,
workflow execution, Playwright, AI integration, deployment, CI/CD, Docker,
React Flow, and business data models.

## Session 02 scope

Session 02 defines the JSON-serializable version 1 workflow contract, including
variables, value sources, locators, steps, assertions, and run statuses. Zod is
the runtime source of truth, and TypeScript types are inferred from its schemas.
The package validates workflow data but does not resolve locators, record
browser events, execute steps, or store workflows.

## Session 03 scope

Session 03 adds local PostgreSQL through Docker Compose, Prisma 7 configuration,
the `Workflow` and immutable `WorkflowVersion` persistence models, runtime
workflow validation before writes, and `GET /health/database`. It does not add
workflow CRUD endpoints, authentication, users, execution, recording, queues,
cloud deployment, or application containers.

## Session 04 scope

Session 04 adds email/password registration and login, short-lived JWT access
tokens, `GET /auth/me`, organization ownership, default workspaces, and
membership-scoped `GET /workspaces`. Registration creates the user,
organization, OWNER membership, and default workspace atomically. Passwords
are hashed with Argon2id and password hashes are never exposed by API response
mappers.

This session does not add refresh tokens, logout, password recovery, email
verification, invitations, organization or workspace CRUD, workflow CRUD, UI
authentication, browser automation, or production deployment.
