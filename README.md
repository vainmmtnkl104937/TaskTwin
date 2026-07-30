# TaskTwin

TaskTwin is a local-first browser workflow automation product. Its intended
interaction is simple: **show a browser task once, review the generated plan,
then run the approved workflow safely**.

> Show it once. Review the plan. Run it safely.

This repository contains the application foundation, framework-independent
workflow and recording domain models, authenticated control-plane foundation,
workflow-input foundation, and publish lifecycle created through Session 13. It
provides buildable
application shells, shared configuration and types, health checks, runtime
workflow validation, local PostgreSQL development tooling, short-lived
access-token authentication, organization-scoped workspaces, deterministic
recorder state, privacy-bounded browser event capture, semantic locator
ranking, deterministic privacy classification, redaction-plan contracts, a
local recording outbox, idempotent recording persistence, and deterministic
draft workflow generation, linear draft visualization, immutable editing
operations, and revision-protected draft saving. Session 14 also adds secure
Local Runner pairing, separate runner credentials, heartbeat, revocation, and
local atomic credential storage. It does not execute workflows or capture
screenshots.

## Browser-first MVP

The first product boundary is browser work initiated through a Chrome
extension and executed by a local runner. A control-plane API and web
application will eventually coordinate workflow metadata and review, while
browser interaction remains on the user's machine. Desktop automation and
general-purpose operating-system control are not part of the browser-first MVP.

## Workspaces

| Workspace                       | Current purpose                                        |
| ------------------------------- | ------------------------------------------------------ |
| `apps/web`                      | Next.js login, workspace list, and draft editor        |
| `apps/api`                      | NestJS control-plane APIs                              |
| `apps/extension`                | Privacy-aware Manifest V3 browser interaction recorder |
| `apps/local-runner`             | Node.js startup and health/status shell                |
| `packages/shared-types`         | Shared service health contract                         |
| `packages/workflow-schema`      | Versioned workflow contracts and runtime validation    |
| `packages/locator-engine`       | Pure locator scoring, ranking, and confidence rules    |
| `packages/privacy-engine`       | Pure privacy classification and redaction-plan rules   |
| `packages/recording-schema`     | Current recording artifact and sync protocol contracts |
| `packages/recording-converter`  | Pure recording-to-draft workflow conversion            |
| `packages/workflow-editor-core` | Pure immutable draft editing and linear graph model    |
| `packages/workflow-inputs`      | Variable, secret-reference, and run-input analysis     |
| `packages/database`             | Prisma identity, workflow, and recording persistence   |
| `packages/config`               | Shared strict TypeScript and ESLint configuration      |
| `packages/runner-protocol`      | Local Runner pairing and heartbeat contracts           |

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
pnpm workflow-editor:check
```

Local Runner pairing additionally requires `RUNNER_PAIRING_CODE_PEPPER` and
`RUNNER_CREDENTIAL_PEPPER`, each at least 32 characters, and
`TASKTWIN_WEB_BASE_URL`. Plain HTTP is supported only for loopback
development.

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

## Session 05 scope

Session 05 adds a deterministic recorder state machine, a Manifest V3 service
worker, session-scoped state restoration, active-tab/origin binding,
state-driven popup controls, and a minimal content-script acknowledgement
boundary. It requests only `activeTab`, `scripting`, and `storage`, with no host
permissions.

The extension still captures no click, input, change, submit, keyboard, form,
page-content, screenshot, or locator data and does not generate workflows.

## Session 06 scope

Session 06 adds runtime-validated candidates for actionable clicks, debounced
text input, selects, checkboxes, and radios. The service worker verifies the
recording session boundary, assigns immutable event identity and sequence, and
persists a bounded session timeline. Pending text input is flushed before blur,
pause, and stop. Password and one-time-code values are represented only as
masked null values.

The popup shows only event count and a fixed action-category summary. This
session does not generate locators or workflows, synchronize with the backend,
execute browser actions, capture arbitrary DOM data, or add broad host access.

## Session 07 scope

Session 07 adds a framework-independent semantic locator engine and an
extension-owned DOM adapter. Each newly accepted recording event contains a
runtime-validated locator bundle with one unique primary locator, unique
ordered fallbacks, deterministic scores, reasons, and confidence. Semantic
test-ID, role, label, placeholder, stable identifier, text, and bounded CSS
strategies are evaluated against the current document.

The event timeline writes schema version 2 while retaining explicit read
compatibility with Session 06 timeline version 1. This session does not create
workflow steps, replay locators, use Playwright or AI, synchronize with the
backend, or repair locators.

## Session 08 scope

Session 08 adds the framework-independent privacy engine, deterministic
sensitivity classification, allow/mask/block policy resolution, and strict
privacy decisions. Personal values are masked by default; authentication,
financial, identity, and health values are blocked and cannot be enabled by
settings. Recording targets and locator text are sanitized while safe
structural identifiers remain available.

The extension stores runtime-validated privacy settings locally and can build
a normalized, viewport-clamped, bounded redaction plan from visible supported
controls. A removable non-interactive preview is available for local fixture
development. This session does not capture or persist screenshots, scan the
complete page, use OCR or AI, synchronize artifacts, claim complete PII
detection, generate workflows, or execute Playwright.

## Session 09 scope

Session 09 extracts the current privacy-aware recording contracts into the
framework-independent `@tasktwin/recording-schema` package. A successful stop
now flushes pending input, validates the complete timeline, creates an
immutable artifact, persists it in `chrome.storage.local`, and creates a
bounded local outbox entry before returning the recorder to idle.

The control plane adds authenticated, workspace-scoped recording-session,
batch, completion, and safe metadata endpoints backed by PostgreSQL.
Application checks, database uniqueness, and transactional batch receipt make
at-least-once delivery idempotent. Completion revalidates stored events and
requires a complete contiguous sequence.

This session does not add extension login or token storage, production HTTP
sync, automatic retries, a recording dashboard, raw-event reads, workflow
conversion, screenshots, AI, or Playwright.

## Session 10 scope

Session 10 adds the framework-independent
`@tasktwin/recording-converter`. It validates a completed artifact, preserves
event order, converts supported interactions into draft workflow steps, and
reports every unresolved or conservatively deduplicated event. Masked personal
input creates required variables; replayable blocked passwords create only
secret reference names. Checkbox and radio state use `setChecked`, never blind
clicks.

The control plane exposes an authenticated, organization-scoped endpoint that
creates a Workflow, version 1 `draft` WorkflowVersion, and idempotent conversion
receipt in one transaction. The source recording remains unchanged and the API
returns only a safe summary.

This session does not add an editor, publishing, Playwright execution, AI,
screenshots, assertion or wait inference, locator repair, or local-runner
behavior.

## Session 11 scope

Session 11 adds an authenticated web bridge and the first draft workflow
editor. The short-lived API access token stays in an HTTP-only cookie and is
used only at Next.js server boundaries. Authorized users can list workflows,
inspect one version, visualize its ordered steps, edit supported safe fields,
add Wait or Approval, reorder or remove steps, validate the complete
definition, and save explicitly.

`WorkflowDefinition.steps` remains the sole execution-order source. React Flow
is a fixed visualization and selection surface. Draft saves use a database
revision separate from the workflow version; a stale revision returns HTTP 409
without replacing local or persisted newer changes. VIEWER remains read-only.

Session 11 does not publish workflows, create new versions, edit locators,
manage secrets or advanced variables, repair workflows, execute browser
actions, use AI, or add Playwright.

## Session 12 scope

Session 12 adds deterministic workflow-variable management, reference and type
validation, derived secret requirements, compatible ValueSource editing, and a
temporary Run Inputs Preview. Preview values remain only in component memory;
secret values and file content have no accepted, rendered, persisted, or
uploaded representation. Workflow variables remain in the versioned
definition, so no database migration is added.

Session 12 does not execute workflows, persist runs or runtime inputs, store
secrets, upload files, publish workflows, add Playwright, or use AI.

## Session 13 scope

Session 13 adds deterministic Draft, Testing, Published, and Archived lifecycle
rules; publish-readiness checks; immutable Published content; version history;
and role-aware lifecycle controls. New edits clone a Published or Archived
source into the next Draft version while preserving prior definitions.

Lifecycle persistence uses optimistic revision checks, serializable
transactions, a Workflow row lock, idempotent creation keys, and a PostgreSQL
partial unique index that permits at most one current Published version per
Workflow. Testing is review state only: this session does not execute or
deploy workflows, use Playwright or AI, show diffs, or implement rollback.

## Session 14 scope

Session 14 adds short-lived device-style pairing, Workspace OWNER/ADMIN
approval, an opaque runner credential separate from the user JWT, heartbeat,
online/offline status, revocation, CLI pairing/status/start/unpair commands,
and atomic local credential persistence.

It does not add Playwright, workflow polling or execution, browser launch,
WebSocket, arbitrary commands, cloud runners, or native keychain integration.
