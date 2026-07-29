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
readiness. Session 04 adds registration, login, current-user, and
membership-scoped workspace reads. There is still no workflow CRUD, queue,
web authentication UI, or API-to-runner connection.

## Control-plane persistence

`@tasktwin/database` owns Prisma configuration, the generated client boundary,
and persistence code. It is a framework-independent package: NestJS dependency
injection and HTTP health behavior stay in `apps/api`.

The control-plane database stores identity and tenancy concepts alongside
versioned workflows:

- `User` stores a normalized unique email, Argon2id password hash, display name,
  and active state.
- `Organization` is the tenant boundary.
- `OrganizationMember` links a user to an organization with one exact role.
- `Workspace` belongs to one organization and scopes workflows.
- `Workflow` is the stable identity and current descriptive metadata.
- `WorkflowVersion` is an append-only revision containing lifecycle status,
  schema version, and the complete workflow definition as PostgreSQL `JSONB`.

`(workflowId, version)` is unique, so a second record cannot overwrite the same
revision. The repository exposes creation but no update operation. A workflow
definition is parsed with `WorkflowDefinitionSchema` before a transaction or
write begins; TypeScript alone is not trusted at this boundary. Application
validation enforces positive workflow and schema versions.

Every new workflow must belong to a workspace. Existing workflows cannot be
assigned safely without tenant knowledge, so the Session 04 migration refuses
to run if the pre-Session-04 workflow table is non-empty.

Deleting a `Workflow` cascades to its versions. This is an explicit relational
choice for future administrative deletion, not a CRUD feature exposed in this
session. Normal version writes remain immutable.

PostgreSQL belongs only to the control plane. The Chrome extension and local
runner do not connect to it, and browser execution remains local.

## Authentication and organization authorization

Registration normalizes email through the shared database-package boundary,
hashes the password with Argon2id, and creates the User, Organization, OWNER
membership, and Default Workspace in one Prisma transaction. Explicit response
mappers expose only safe user fields.

Login returns a short-lived HS256 access token. The application payload
contains only `sub`, the immutable user ID; standard `iat` and `exp` claims are
added by the JWT library. Organization roles and mutable workspace permissions
are not embedded in the token. Protected requests verify the token, then load
the current active user from the database.

`GET /workspaces` does not trust an organization ID from the client. Its
database query reaches workspaces only through organizations for which the
current user has an `OrganizationMember` record. A reusable role decorator and
guard operate only on an internally attached, verified organization context.
No Session 04 endpoint needs an organization role decision beyond the
membership-scoped query, so the role guard is provided and independently
tested without being attached to an artificial route.

## Local execution plane

The Chrome extension and local runner form the local execution side. Browser
access belongs here so that future browser interaction happens in the user's
environment rather than in a remote cloud browser.

Session 05 makes the extension service worker the authoritative recorder-state
coordinator. The popup sends validated commands and renders state, while a
dynamically injected content script receives validated state notifications.
Recorder state uses session-scoped Chrome storage so popup closure and
service-worker suspension do not lose it.

Session 06 keeps the service worker authoritative for the event timeline.
The content script uses document-level delegated listeners to construct strict,
sanitized event candidates. The worker accepts candidates only while recording
and only from the bound top-level tab and origin. It then assigns session ID,
tab ID, event ID, and monotonically increasing sequence before persisting the
accepted event. Candidates cannot choose authoritative envelope fields.

The capture boundary supports actionable primary clicks, debounced text-input
changes, single selects, checkboxes, and selected radios. Pending input is
flushed before blur, pause, and stop. Password and one-time-code values are
stored as masked nulls; hidden and file inputs are ignored. Target snapshots
use a bounded allowlist rather than DOM serialization or arbitrary attributes.
The popup receives only event count and a fixed event-category summary.

Session 07 adds a DOM-to-contract boundary without changing timeline
authority. The extension DOM adapter reads only bounded, allowlisted metadata,
derives accessible names and labels, and checks every proposed locator against
the current document. It passes observations to
`@tasktwin/locator-engine`, whose framework-independent rules score, deduplicate,
rank, explain, and assign confidence. Only candidates matching exactly one
element are included.

New accepted events use timeline schema version 2 and contain a validated
`LocatorBundle` version 1. The primary candidate is unique, fallbacks are
unique and ordered, and CSS is a bounded low-priority fallback. The storage
adapter writes the v2 key and can read the previous v1 key for popup summary
compatibility. A new recording always replaces legacy data with an empty v2
timeline; old events are not silently upgraded because they have no verified
locator bundle.

The event timeline shares the recorder's `chrome.storage.session` lifecycle.
It has a hard capacity. Reaching the limit changes the recorder to an explicit
error instead of silently discarding older or newer events. Starting a new
recording explicitly replaces the prior session timeline; stopping preserves
the completed timeline for popup inspection until the next start.

The extension requests only `activeTab`, `scripting`, and `storage`.
`activeTab` limits page access to the tab explicitly selected when the user
invokes the extension. There are no host permissions or static content
scripts.

The runner continues to report a typed health status and log a safe startup
message; it has no browser automation dependency and executes no workflow.

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
- `packages/locator-engine` owns pure locator contracts, scoring constants,
  dynamic-value heuristics, deterministic ranking, explanations, and
  confidence. It depends only on the shared workflow locator contract and Zod;
  DOM and Chrome behavior remain in the extension.
- Application packages own framework bootstrapping and presentation, without
  introducing domain behavior.

Recorder message contracts and deterministic transition logic currently live
inside `apps/extension` because only extension contexts consume them. They are
kept independent from Chrome adapters so they can be tested without a browser.

Future policy and execution packages described by the project direction are
intentionally absent until their sessions define them.

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

- The extension uses temporary active-tab access and has no broad host
  permissions.
- Passwords cross only registration and login boundaries. Plaintext passwords
  are never logged or stored; password hashes are never selected by normal user
  reads or returned from API responses.
- No browser event, screenshot, cookie, access token, password, or OTP is
  captured as a plaintext secret. Password and OTP input events may be retained
  only with a null value and a fixed masking reason.
- Recorder storage contains versioned state and a bounded interaction timeline.
  The timeline uses allowlisted, length-bounded target metadata and event
  payloads. Complete page URLs, full DOM, outerHTML, arbitrary attributes, raw
  inbound messages, and input values in the popup are excluded from logs and
  presentation.
- Locator data never reads an input value and contains no DOM nodes, HTML,
  arbitrary attributes, complete DOM paths, or full page content. Test IDs use
  a four-attribute allowlist. Text, identifiers, labels, names, placeholders,
  and CSS selectors are normalized and bounded before persistence.
- Workflow secret value sources store only a validated reference name, never a
  secret value.
- Database credentials come from environment configuration. URLs and passwords
  are not returned by health endpoints or written to application logs.
- JWT signing configuration comes only from validated environment values. The
  access-token lifetime is bounded and the signing secret must be at least 32
  characters.
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
