# TaskTwin Current State

Last completed session: **40**

## Release candidate

- The product release tag `v1.0.0-rc.1` lives in the top-level `VERSION` file
  and is documented in `docs/RELEASE.md`. The tag does not mutate any
  package, Runner or workspace version; it is the single, machine-readable
  source of truth for the release candidate.
- A repeatable UAT checklist lives in `docs/uat/v1-primary.md` with twelve
  scenarios covering Record → Draft → Publish → Run, approval, scheduling,
  repair, audit, notifications and fleet rollouts. The operator smoke runbook
  lives in `docs/uat/v1-smoke-test.md`; the live known-issues register lives
  in `docs/uat/known-issues-v1.0.0-rc.1.md`.
- Severity model `docs/severity.md` defines P0/P1/P2/P3. V1 release blockers
  and acceptance-critical P1s block promotion to the next product release
  tag.
- A first-time Runner onboarding guide lives in `docs/onboarding/v1-runner.md`.

## Workflow

- The Chrome extension records supported clicks, text changes, selects,
  checkboxes and radios using bounded target metadata, deterministic privacy
  decisions and semantic locator bundles. Completed artifacts are immutable,
  locally queued and idempotently persisted by the Control Plane.
- Completed recordings convert deterministically into Draft workflows with
  provenance, explicit unresolved issues and safe variable/secret references.
- The web editor presents a linear workflow whose `steps` array is the sole
  execution order. It supports immutable edit operations, typed variables,
  value-source compatibility, optimistic revisions and temporary in-memory Run
  Inputs Preview.
- Workflow versions move through Draft, Testing, Published and Archived states.
  Publishing persists a definition whose internal status also becomes Published.
  Published definitions are immutable; later changes clone a new Draft.

## Execution

- A paired Local Runner authenticates independently from users, advertises
  capabilities, claims at most one assigned run and renews a hashed lease.
- The framework-independent Workflow Engine preflights and executes sequentially
  through a Local Runner Playwright adapter. Each run uses an isolated,
  non-persistent Chromium context and an explicit origin allowlist.
- WorkflowRun and step state, monotonic progress and safe completion metadata
  persist in PostgreSQL. Expired leases interrupt runs and are never reused or
  automatically requeued.
- Runtime variables are end-to-end encrypted to the assigned Runner. Plaintext
  and Runner private keys remain local. Runtime outputs live only in Runner
  memory; the Control Plane stores producer/status metadata.
- Verify steps support deterministic URL, text, visibility, field-value and
  checked-state checks with bounded polling and value-free results.
- Approval steps pause before their immediate next step for OWNER/ADMIN action
  while the Runner retains its current lease and browser context.
- Conservative recovery permits one bounded retry only for explicitly transient
  read-only failures. Attended repair retains the current run context; crashed
  runs are not resumed.
- Locator repair produces bounded privacy-filtered, read-only-tested proposals.
  An accepted proposal can modify only a compatible existing Draft and never
  changes or resumes production execution silently.

## Governance and operations

- Each Workspace can have immutable, versioned deterministic execution policy.
  Runs pin policy; deny has precedence and the Runner re-evaluates policy as
  defense in depth.
- The Audit Trail is append-only, hash-chained and transactionally coupled to
  domain mutations. Typed payloads exclude runtime and sensitive values.
- Database-backed schedules support one-time, daily and weekly IANA-timezone
  occurrences, DST rules, transactional idempotency and multi-instance claims.
  Dispatch materializes complete policy-pinned runs with executable steps,
  origins, outputs and local-secret inventory pins. Unsafe policy changes or
  ambiguous outcomes pause scheduling for review.
- Operational alerts use strict templates, transactional outbox records,
  OWNER/ADMIN-aware routing, idempotent in-app delivery and bounded retry/dead
  letter handling.
- Operational telemetry exposes fixed-window, low-cardinality Workspace
  aggregates and component readiness without workflow business data, Runner
  identities, versions or runtime values as public labels.
- High-volume Workspace lists use bounded stable cursors and hot-path
  projections. Runner claims, schedule dispatch, notification delivery,
  approvals, Audit appends and fleet convergence retain database-backed
  locking/idempotency under concurrent workers; a repeatable read-only query
  baseline covers the main dispatch and operational paths.
- The Control Plane has separate production images/processes for Web, API,
  Scheduler and Notification Worker. A persistent PostgreSQL service and
  explicit one-shot migration job gate startup; runtime secrets stay outside
  image layers and health/readiness supports container orchestration.
- Production operations include compressed versioned PostgreSQL backups,
  SHA-256 integrity sidecars, bounded retention, clean-database restore,
  restored audit-chain verification and a repeatable two-database DR drill.
- The HTTP boundary applies exact-origin production CORS, security headers,
  bounded request/connection handling, correlation IDs, sanitized errors and
  redacted production logging. Login, registration, pairing and authenticated
  Runner endpoints have scoped process-local abuse controls.

## Runner

- The encrypted Local Secret Store keeps secret values on the Runner. The
  Control Plane receives safe inventory alias/version metadata only. Scheduled
  execution resolves pinned secret inventory locally with no environment
  fallback.
- The Windows Runner supports Interactive, Unattended Process and Windows
  Service modes, single-process locking, graceful drain, bounded reconnect and
  fresh-process recovery. DPAPI-NG protection enables native unattended vault
  unlock where configured.
- Signed Windows x64 releases use strict canonical manifests, detached Ed25519
  signatures, trusted public keys and explicit protocol/workflow/local-state/
  vault compatibility. Product version newness is not compatibility.
- Local update and rollback accept already-downloaded signed releases, verify
  before mutation, drain active work, use versioned installation state, require
  local startup health and fail to manual recovery when rollback is ambiguous
  or unsafe.
- Explicit local release acquisition accepts only a version or signed-manifest
  digest reference from a static allowlisted HTTPS source. It streams bounded
  bytes into an isolated partial cache, safely resumes only with exact strong
  remote identity, verifies signed size and SHA-256, and atomically promotes
  inert data into a verified cache. Acquisition never invokes installation.
- The trusted release catalog stores verified signed manifest history as
  available, deprecated or blocked. Unsigned metadata cannot become trusted.
- Runner compliance separates actual authenticated identity, declarative
  desired release and explicit compatibility.
- Workspace fleet rollouts target one available release using ordered stages
  with explicit Runner membership. OWNER/ADMIN activates every stage manually.
  Heartbeats establish convergence and observe rollback; the Control Plane
  never executes update or rollback.
- A blocked actual release cannot claim new jobs. Blocking an active rollout
  target pauses progression and emits one action-required alert without
  downgrading the Runner.

## Validation

- `pnpm e2e:golden` runs a Docker-isolated full-system path through fresh
  migrations, API/Web, extension recording and sync, real Playwright Runner
  execution, approvals, repair, scheduling, notifications, audit verification,
  reconnect and sensitive-value leak checks.

## Current limitations

- Browser automation is Chromium-focused; no general desktop automation,
  arbitrary JavaScript, remote shell, screenshots, persistent personal browser
  profiles or cloud Runner execution is provided.
- Runs do not support branching, loops, parallel steps, crash resume or
  automatic retry of uncertain/mutating effects.
- Operational notifications are in-app only; public metrics, distributed
  tracing, external APM/SIEM and infrastructure auto-remediation are absent.
- Production Runner artifacts currently target Windows x64. The trusted public
  key registry is intentionally empty until deployment supplies reviewed public
  keys.
- Runner update has no discovery feed, GitHub polling, background download,
  automatic install, schema migration, remote installation or remote rollback.
  The default release-source registry remains empty until deployment supplies
  a reviewed HTTPS source, and unmanaged installations need a separately
  controlled bootstrap.
- Fleet rollout has no percentage/random cohorts, automatic stage promotion,
  auto-remediation or forced downgrade.
- The production deployment baseline is single-host Docker Compose. It does not
  provide a reverse proxy, managed TLS, database HA, point-in-time recovery,
  automatic off-host backup copy, image publishing,
  autoscaling, multi-region operation or cloud-specific infrastructure.
- Abuse limits are in-memory per API process; there is no distributed limiter,
  edge WAF, CAPTCHA, SSO, external SIEM or automated dependency remediation.
- The performance baseline is intentionally small and local; it is not a
  production-capacity model and does not replace workload-specific load tests.

## User-facing stabilization (v1.0.0-rc.1)

- The login page surfaces an "expired session" banner when the user is
  redirected from an expired access token.
- The Workspaces home shows a three-step welcome checklist (extension
  installed, Runner paired, Local Secret Store ready) sourced from the
  Runner Devices list.
- Heavy pages now expose `loading.tsx` skeletons with shimmering placeholders
  that respect the reduced-motion preference.
- The root `error.tsx` reports the stable internal code, suggests retry and
  reminds the user to never paste secret values.
- The Audit Verify panel uses human-readable labels for the chain status
  ("Audit chain verified", "Audit chain mismatch", "Audit chain has a gap")
  and failure kinds. The Runner release catalog page uses the same labels
  via `lib/runner-rollout-labels.ts`.
- The Fleet view adds a shortcut to the fleet rollouts page and clarifies
  runtime mode, service state, Local Secret Store status and connection
  semantics.
- The Run Evidence panel reports Control Plane errors with their stable
  technical code and never shows recorded values.
- The Operations dashboard replaces snake-case enum displays with explicit
  state labels and clarifies Audit Integrity ("Chain intact / mismatch /
  sequence gap").
- The Draft editor adds a policy digest panel summarising the active
  Workspace execution policy and the count of deny/warn findings against
  the current definition.
