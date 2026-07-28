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

The web application and API form the control-plane side of the architecture.
The web application will eventually present workflow information and review
states. The API will coordinate control-plane operations. It is not intended to
drive a browser directly.

In Session 01, the web application is a static landing page with a running
status, and the API exposes only `GET /health`. There is no authentication,
database, queue, workflow model, or API-to-runner connection.

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
- There is no AI behavior, policy bypass, or silent workflow repair.
- Local execution is a responsibility boundary only; it is not implemented.

## Build architecture

pnpm manages workspace dependencies through a single lockfile. Turborepo
orders tasks so shared packages build before consumers. Each application and
package exposes its own build, lint, and typecheck scripts where applicable,
while root commands validate the repository consistently.
