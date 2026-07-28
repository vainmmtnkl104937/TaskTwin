# TaskTwin

TaskTwin is a local-first browser workflow automation product. Its intended
interaction is simple: **show a browser task once, review the generated plan,
then run the approved workflow safely**.

> Show it once. Review the plan. Run it safely.

This repository contains the Session 01 application foundation and the Session
02 framework-independent workflow domain model. It provides buildable
application shells, shared configuration and types, health checks, runtime
workflow validation, and architecture documentation. It does not yet record or
execute workflows.

## Browser-first MVP

The first product boundary is browser work initiated through a Chrome
extension and executed by a local runner. A control-plane API and web
application will eventually coordinate workflow metadata and review, while
browser interaction remains on the user's machine. Desktop automation and
general-purpose operating-system control are not part of the browser-first MVP.

## Workspaces

| Workspace                  | Current purpose                                         |
| -------------------------- | ------------------------------------------------------- |
| `apps/web`                 | Next.js landing page and web health indicator           |
| `apps/api`                 | NestJS control-plane shell with `GET /health`           |
| `apps/extension`           | Manifest V3 popup shell with disabled recorder controls |
| `apps/local-runner`        | Node.js startup and health/status shell                 |
| `packages/shared-types`    | Shared service health contract                          |
| `packages/workflow-schema` | Versioned workflow contracts and runtime validation     |
| `packages/config`          | Shared strict TypeScript and ESLint configuration       |

The architectural direction is documented in
[`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

## Requirements

- Node.js 22.13 or later within the Node 22 release line
- Corepack
- pnpm 10.34.5

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

No credentials or secrets are required by the current repository.

## Session 02 scope

Session 02 defines the JSON-serializable version 1 workflow contract, including
variables, value sources, locators, steps, assertions, and run statuses. Zod is
the runtime source of truth, and TypeScript types are inferred from its schemas.
The package validates workflow data but does not resolve locators, record
browser events, execute steps, or store workflows.
