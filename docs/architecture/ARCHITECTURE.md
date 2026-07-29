# TaskTwin Architecture

## Overview

TaskTwin is designed as a local-first browser automation system with two
execution boundaries:

```text
Control plane                              Local execution plane
┌──────────────────────┐                   ┌──────────────────────┐
│ Web application      │                   │ Chrome extension     │
│ Review and status UI │                   │ Browser interaction  │
└──────────┬───────────┘                   └──────────┬───────────┘
           │                                          │
┌──────────▼───────────┐                   ┌──────────▼───────────┐
│ API                  │                   │ Local runner         │
│ Coordination boundary│                   │ Approved execution   │
└──────────────────────┘                   └──────────────────────┘
```

Session 01 establishes only the component shells shown above. The arrows
describe intended responsibility boundaries, not communication implemented in
this session.

## Control plane

The web application, API, and PostgreSQL database form the control-plane side
of the architecture.
The web application will eventually present workflow information and review
states. The API will coordinate control-plane operations. It is not intended to
drive a browser directly.

The web application remains a static landing page. The API exposes its original
`GET /health` liveness endpoint and `GET /health/database` for database
readiness. Session 03 adds only workflow definition persistence; there is still
no authentication, queue, workflow CRUD, or API-to-runner connection.

## Control-plane persistence

`@tasktwin/database` owns Prisma configuration, the generated client boundary,
and persistence code. It is a framework-independent package: NestJS dependency
injection and HTTP health behavior stay in `apps/api`.

The control-plane database stores two concepts:

- `Workflow` is the stable identity and current descriptive metadata.
- `WorkflowVersion` is an append-only revision containing lifecycle status,
  schema version, and the complete workflow definition as PostgreSQL `JSONB`.

`(workflowId, version)` is unique, so a second record cannot overwrite the same
revision. The repository exposes creation but no update operation. A workflow
definition is parsed with `WorkflowDefinitionSchema` before a transaction or
write begins; TypeScript alone is not trusted at this boundary. Application
validation enforces positive workflow and schema versions.

Deleting a `Workflow` cascades to its versions. This is an explicit relational
choice for future administrative deletion, not a CRUD feature exposed in this
session. Normal version writes remain immutable.

PostgreSQL belongs only to the control plane. The Chrome extension and local
runner do not connect to it, and browser execution remains local.

## Local execution plane

The Chrome extension and local runner form the local execution side. Browser
access belongs here so that future browser interaction happens in the user's
environment rather than in a remote cloud browser.

In Session 01, the extension has no Chrome permissions and cannot capture
events. Its controls are disabled. The runner reports a typed health status and
logs a safe startup message; it has no browser automation dependency and
executes no workflow.

## Package boundaries

- `packages/shared-types` contains framework-independent contracts that cross
  workspace boundaries. Session 01 defines only service health.
- `packages/workflow-schema` is the runtime-validated, framework-independent
  contract shared by the extension, API, web editor, and local runner. It
  defines data only and does not depend on any application framework.
- `packages/database` is the framework-independent Prisma persistence boundary.
  It depends on `workflow-schema` to validate definitions before writes, but it
  has no NestJS or application dependency.
- `packages/config` centralizes strict TypeScript and ESLint configuration.
- Application packages own framework bootstrapping and presentation, without
  introducing domain behavior.

Future locator, policy, and execution packages described by the project
direction are intentionally absent until their sessions define them.

## Workflow contract

`@tasktwin/workflow-schema` uses Zod as the runtime source of truth. TypeScript
types are inferred from the same schemas so compile-time consumers and
untrusted JSON inputs share one contract.

Workflow definition version 1 is a strict, JSON-serializable object. Its
`steps` array records execution order explicitly. Steps, locators, value
sources, and assertions are discriminated unions, which gives each variant a
stable discriminator and variant-specific required fields. Unknown variants
and unexpected object properties are rejected.

`schemaVersion` versions the shape of the contract. The separate positive
workflow `version` identifies revisions of a workflow. Published-version
immutability remains an application and persistence responsibility in a later
session; the schema cannot enforce changes across stored records.

Runtime validation is required because workflow definitions will eventually
cross extension, API, editor, file, and local-runner boundaries. TypeScript
types disappear at runtime and cannot protect those boundaries by themselves.
The schema package remains independent from Next.js, NestJS, Chrome APIs,
Prisma, and Playwright so every plane can consume the same domain contract.

## Safety and trust boundaries

- The extension uses least privilege and currently requests no permissions.
- No service accepts or stores credentials in Session 01.
- No browser event, screenshot, cookie, access token, password, or OTP is
  captured.
- Workflow secret value sources store only a validated reference name, never a
  secret value.
- Database credentials come from environment configuration. URLs and passwords
  are not returned by health endpoints or written to application logs.
- The normal unit-test suite mocks persistence and does not silently skip or
  connect to PostgreSQL. The real integration check is opt-in and fails when
  configuration, connectivity, or migrations are missing.
- There is no AI behavior, policy bypass, or silent workflow repair.
- Local execution is a responsibility boundary only; it is not implemented.

## Build architecture

pnpm manages workspace dependencies through a single lockfile. Turborepo
orders tasks so shared packages build before consumers. Each application and
package exposes its own build, lint, and typecheck scripts where applicable,
while root commands validate the repository consistently.
