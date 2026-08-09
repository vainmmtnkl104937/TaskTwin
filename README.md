# TaskTwin

TaskTwin is a local-first browser workflow automation product. Its intended
interaction is simple: **show a browser task once, review the generated plan,
then run the approved workflow safely**.

> Show it once. Review the plan. Run it safely.

This repository contains the application foundation, framework-independent
workflow and recording domain models, authenticated control-plane foundation,
workflow-input foundation, and publish lifecycle. It provides buildable
application shells, shared configuration and types, health checks, runtime
workflow validation, local PostgreSQL development tooling, short-lived
access-token authentication, organization-scoped workspaces, deterministic
recorder state, privacy-bounded browser event capture, semantic locator
ranking, deterministic privacy classification, redaction-plan contracts, a
local recording outbox, idempotent recording persistence, and deterministic
draft workflow generation, linear draft visualization, immutable editing
operations, and revision-protected draft saving. Session 14 adds secure Local
Runner pairing, separate runner credentials, heartbeat, and revocation.
Session 15 adds validated, isolated local Chromium execution for six workflow
step types without connecting a Control Plane job system.
Session 16 adds a deterministic framework-independent workflow engine with
explicit lifecycle, timeout, cancellation, progress, skipped-step, and cleanup
semantics behind a Playwright adapter.
Session 17 adds persisted run dispatch and Session 18 adds end-to-end encrypted
runtime variables plus local-only secret resolution for an assigned Runner.
Session 19 adds deterministic verification, and Session 20 adds ephemeral
Runner-only extraction outputs with metadata-only Control Plane tracking.
Session 24 introduces a deterministic Workspace execution policy with
immutable versions, origin/action/risk evaluation and pinned runs.
Session 25 adds an append-only, hash-chained audit trail with API and web
surfaces. Sessions 26 through 30 add safe scheduling, operational alerts and
telemetry, the Local Secret Store, and the production Windows Runner service
with native secret auto-unlock. Session 31 adds immutable Windows x64 Runner
release archives, canonical signed manifests, local verification/preflight and
protocol/schema compatibility gates. Session 32 adds a local operator-invoked
Windows x64 update/rollback controller with verify-before-mutate staging,
active-run drain, versioned installed releases, local startup health and
crash-safe recovery. It still does not provide release downloading, remote or
silent updates, schema migration, browser-profile reuse or screenshots.

## Browser-first MVP

The first product boundary is browser work initiated through a Chrome
extension and executed by a local runner. A control-plane API and web
application will eventually coordinate workflow metadata and review, while
browser interaction remains on the user's machine. Desktop automation and
general-purpose operating-system control are not part of the browser-first MVP.

## Workspaces

| Workspace                       | Current purpose                                         |
| ------------------------------- | ------------------------------------------------------- |
| `apps/web`                      | Next.js login, workspace list, and draft editor         |
| `apps/api`                      | NestJS control-plane APIs                               |
| `apps/extension`                | Privacy-aware Manifest V3 browser interaction recorder  |
| `apps/local-runner`             | Paired local Chromium execution service                 |
| `packages/shared-types`         | Shared service health contract                          |
| `packages/workflow-schema`      | Versioned workflow contracts and runtime validation     |
| `packages/locator-engine`       | Pure locator scoring, ranking, and confidence rules     |
| `packages/privacy-engine`       | Pure privacy classification and redaction-plan rules    |
| `packages/recording-schema`     | Current recording artifact and sync protocol contracts  |
| `packages/recording-converter`  | Pure recording-to-draft workflow conversion             |
| `packages/workflow-editor-core` | Pure immutable draft editing and linear graph model     |
| `packages/workflow-inputs`      | Variable, secret-reference, and run-input analysis      |
| `packages/workflow-engine`      | Deterministic execution lifecycle and orchestration     |
| `packages/workflow-extraction`  | Pure output data-flow and compatibility analysis        |
| `packages/database`             | Prisma identity, workflow, and recording persistence    |
| `packages/config`               | Shared strict TypeScript and ESLint configuration       |
| `packages/runner-protocol`      | Local Runner pairing and heartbeat contracts            |
| `packages/run-protocol`         | Persisted run, lease, progress and completion contracts |
| `packages/runner-release`       | Signed release and compatibility contracts              |
| `packages/runner-update`        | Pure update, rollback, health and recovery decisions    |
| `packages/audit-trail`          | Append-only, hash-chained audit events and verification |

The architectural direction is documented in
[`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

Runner release operations are documented in
[`docs/runner-version.md`](docs/runner-version.md),
[`docs/runner-release-packaging.md`](docs/runner-release-packaging.md),
[`docs/runner-release-manifest.md`](docs/runner-release-manifest.md),
[`docs/runner-compatibility.md`](docs/runner-compatibility.md),
[`docs/runner-upgrade-preflight.md`](docs/runner-upgrade-preflight.md), and
[`docs/runner-release-pipeline.md`](docs/runner-release-pipeline.md).
Local update operations are documented in
[`docs/runner-update.md`](docs/runner-update.md),
[`docs/windows-runner-update-layout.md`](docs/windows-runner-update-layout.md),
[`docs/runner-update-rollback.md`](docs/runner-update-rollback.md), and
[`docs/runner-update-recovery.md`](docs/runner-update-recovery.md).

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
development. Run dispatch also requires `RUNNER_JOB_LEASE_PEPPER` with at
least 32 characters.

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

## Session 15 scope

Session 15 adds Playwright-based local Chromium execution to the Local Runner.
It validates the complete request and explicit allowed origins before launch,
uses one isolated non-persistent BrowserContext per execution, and supports
Navigate, Click, Fill, Select, SetChecked, and Wait in sequential fail-fast
order. Locators must match exactly one element, secret references fail closed,
and browser resources are always cleaned up with value-safe reporting.

It does not add Control Plane jobs, WorkflowRun persistence, job polling,
persistent browser profiles, saved authentication, secret resolution,
Extract, Verify or Approval execution, screenshots, tracing, retries, locator
repair, AI, scheduling, or parallel execution.

## Session 16 scope

Session 16 adds the framework-independent deterministic workflow engine with
explicit run and step state machines, preflight before adapter startup,
sequential fail-fast execution, typed skipped steps, total and step timeouts,
idempotent cancellation, safe progress events, complete validated results, and
guaranteed cleanup reporting. Playwright remains behind the Local Runner
adapter.

It does not add Control Plane jobs, WorkflowRun persistence, polling, retries,
resume, approval, branching, parallel execution, screenshots, traces, secret
resolution, scheduling, or AI.

## Session 17 scope

Session 17 adds framework-independent run-dispatch contracts, transactional
WorkflowRun and WorkflowRunStep persistence, assigned-runner claims, hashed
renewable leases, monotonic idempotent progress batches, validated completion,
cooperative cancellation, interruption on lease expiry, and safe Web run
history. The Local Runner keeps one active job and executes it through the
existing workflow engine and isolated Playwright adapter.

It does not deliver runtime variables, files or secrets; requeue or retry an
Interrupted run; add Redis, WebSocket, scheduling, parallel jobs, persistent
browser profiles, screenshots or AI.

## Session 18 scope

Session 18 adds a framework-independent secure-input contract, Runner-owned
RSA key pairs, browser-side AES-GCM encryption, short-lived run preparation,
ciphertext-only persistence and assigned-Runner decryption. Declared secret
aliases are prompted locally without echo and disposed after execution.

It does not transfer files, send secret values through Web or API, persist
plaintext inputs, rotate keys, use an OS keychain, retry or resume runs, or add
AI.

## Session 19 scope

Session 19 adds deterministic URL, text, visibility, field-value, and
checked-state verification. Verify steps use bounded cancellable polling,
unique read-only locators, safe value-free reporting, Runner capability
gating, and the existing fail-fast workflow lifecycle.

It does not add visual comparison, regular expressions, custom JavaScript,
XPath, automatic verification generation, locator repair, screenshots, or AI.

## Session 20 scope

Session 20 adds deterministic text, field-value, checked-state, and safe URL
extraction. Runtime outputs are produced once, consumed only by later steps,
kept in Runner memory, and cleared on every terminal path. The Control Plane
stores output metadata and status only; extracted values are never transmitted
or persisted.

It does not add arrays, transformations, loops, branching, network extraction,
custom JavaScript, output previews, screenshots, or AI.

## Session 21 scope

Session 21 adds explicit human approval gates for the immediate next workflow
step. The Runner preserves its browser session and lease while OWNER or ADMIN
users approve or reject through a safe Workspace Approval Center. Requests,
decisions, expiry, cancellation, and invalidation are persisted without runtime
values, secrets, outputs, locators, or full URLs.

It does not add email approval, comments, quorum policies, approver groups,
workflow-wide approval, crash resume, automatic requeue, or AI decisions.

## Session 22 scope

Session 22 adds deterministic, bounded retry for explicitly safe read-only
failures and attended manual repair of the exact failed step. Attempts and
repair decisions persist only safe metadata while the Runner retains its
isolated browser session, in-memory inputs and outputs, heartbeat, and lease.

It does not add locator editing, step skipping, workflow or browser restart,
uncertain-side-effect retry, automatic requeue, crash resume, or AI repair.

## Session 23 scope

Session 23 adds deterministic, privacy-filtered locator repair proposals for
eligible failures. The Runner tests candidates read-only in the current page
context; users may apply a passed candidate only to a compatible existing
Draft with optimistic revision protection.

It does not resume the failed run, override a runtime locator, modify Published
versions, create or publish Drafts automatically, upload DOM or screenshots,
or use XPath, workflow JavaScript, or AI.

## Session 24 scope

Session 24 adds immutable Workspace execution-policy versions, deterministic
origin and action-risk decisions, explicit Approval requirements, policy-pinned
runs, stale queued-run rejection, and independent Local Runner enforcement.

It does not add policy scripts, AI classification, automatic approvals or
workflow edits, active-run policy mutation, or an emergency kill switch.
