# TaskTwin Roadmap

This roadmap describes product direction without committing dependencies or
implementation details before they are needed.

## Session 01: foundation

- pnpm and Turborepo monorepo
- Strict TypeScript, ESLint, Prettier, and unit-test support
- Web landing page
- API health endpoint
- Manifest V3 extension popup shell
- Local runner startup/status shell
- Shared service health type
- Product and architecture documentation

## Session 02: workflow domain model

- Framework-independent `@tasktwin/workflow-schema` package
- Version 1 workflow definition and lifecycle status
- Strict runtime validation with Zod
- Variables, value sources, locators, ordered steps, and assertions
- Run and run-step status contracts
- Reusable valid workflow fixture

Session 02 defines deterministic, versioned workflow data. It does not add
recording, persistence, editing, policy evaluation, or execution behavior.

## Session 03: control-plane persistence

- Local PostgreSQL and Prisma 7 foundation
- Immutable workflow-version persistence
- Runtime schema validation at the write boundary
- Database readiness endpoint and opt-in integration check

## Session 04: authentication and workspace foundation

- User registration and login with Argon2id password hashing
- Short-lived JWT access tokens
- User, Organization, OrganizationMember, and Workspace persistence
- Atomic OWNER organization and default workspace provisioning
- Protected current-user and membership-scoped workspace endpoints
- Reusable organization-role authorization guard

Session 04 deliberately excludes refresh tokens, recovery and verification
flows, invitations, tenant-management CRUD, UI authentication, and workflow
HTTP endpoints.

## Session 05: recorder state and extension coordination

- Deterministic recording-state machine
- Runtime-validated popup, service-worker, and content-script messages
- Session-scoped Chrome storage and popup-reopen restoration
- Active-tab and origin binding
- State-driven start, pause, resume, stop, and reset controls
- Least-privilege dynamic content-script injection

Session 05 coordinates recorder state only. It does not capture interactions,
inspect page content, generate workflows, synchronize with the backend, or
communicate with the local runner.

## Session 06: privacy-bounded browser event capture

- Strict event-candidate, accepted-event, and timeline contracts
- Service-worker-owned event identity, ordering, and persistence
- Actionable click, debounced text-input, select, checkbox, and radio capture
- Password and one-time-code value masking
- Bounded target metadata and event timeline
- Safe popup event count and action summary
- Local manual recorder fixture

Session 06 records only the approved minimal interaction categories. It does
not generate locators or workflows, sync events, execute actions, capture
arbitrary attributes or DOM, or request broad host permissions.

## Session 07: deterministic semantic locator engine

- Framework-independent locator scoring, ranking, deduplication, and confidence
- Extension DOM adapter for accessible names and current-document match counts
- Unique semantic primary locators and unique bounded fallbacks
- Deterministic dynamic-identifier penalties and rule-based explanations
- Runtime-validated locator bundles on timeline schema version 2 events
- Explicit read compatibility for Session 06 timeline version 1

Session 07 ranks locators only. It does not replay them, generate workflow
steps, synchronize recordings, repair production locators, or use AI,
Playwright, screenshots, computer vision, XPath, or broad host permissions.

## Session 08: deterministic privacy and redaction-plan foundation

- Framework-independent sensitivity classification and policy resolution
- Strict version 1 privacy decisions and settings
- Bounded English and explicit Vietnamese privacy rules
- Personal-data masking by default and non-weakenable blocked categories
- Recording-value, target-snapshot, and locator-text sanitization
- JSON-serializable viewport redaction plans with deterministic geometry
- Local runtime-validated privacy settings and optional fixture preview

Session 08 creates only the classification, sanitization, geometry, and local
preview boundaries. It does not capture, persist, upload, or synchronize
screenshots; scan free-form page content; use OCR, computer vision, or AI;
claim complete PII detection or compliance certification; generate workflows;
or execute Playwright.

## Session 09: durable recording artifacts and control-plane sync

- Framework-independent current recording, artifact, and sync contracts
- Validated immutable artifacts in bounded `chrome.storage.local` storage
- Local pending/syncing/synced/failed outbox state
- Authenticated workspace-scoped recording-session APIs
- Idempotent bounded event batches and processed-batch receipts
- Transactional PostgreSQL event persistence
- Completion-time privacy, count, origin, and sequence verification
- Safe metadata reads without raw events

Session 09 provides a transport abstraction and tests at-least-once
orchestration with a mock. Extension authentication, production HTTP sync,
automatic retry scheduling, recording review UI, workflow conversion,
screenshots, AI, and execution remain out of scope.

## Session 10: deterministic recording-to-workflow conversion

- Framework-independent recording converter and strict conversion contracts
- Deterministic event-to-step mappings, IDs, names, and provenance
- Draft-only `setChecked` support for checkbox and radio state
- Required variables for masked personal input
- Secret-reference-only handling for replayable blocked passwords
- Explicit unresolved events, warnings, deduplication, and publishable status
- Transactional Workflow, WorkflowVersion, and conversion-receipt persistence
- Authenticated organization-scoped, idempotent draft-creation endpoint

Session 10 converts completed recordings into version 1 draft workflows. It
does not add workflow editing, publishing, execution, Playwright, AI,
screenshots, locator repair, wait/assertion inference, or local-runner changes.

## Session 11: authenticated draft workflow editor

- Framework-independent immutable workflow editor operations
- HTTP-only web authentication bridge to the existing control plane
- Workspace workflow list and version detail reads
- Fixed linear React Flow visualization driven by `steps` array order
- Safe draft property editing with locator and secret boundaries
- Explicit validation and save behavior
- Database-backed draft revision and optimistic concurrency
- OWNER, ADMIN, and MEMBER writes with VIEWER read-only access

Session 11 deliberately excludes publishing, workflow-version creation,
branching, arbitrary graph connections, advanced variables, locator repair,
collaboration, auto-save, execution, Playwright, AI, and refresh tokens.

## Session 12: workflow variables and temporary run inputs

- Deterministic variable and secret-reference usage analysis
- Explicit variable-to-step compatibility rules
- Immutable variable management and atomic reference rename
- Compatible ValueSource selection in the Draft editor
- Component-memory-only Run Inputs Preview
- Safe file metadata without file upload
- Structured semantic validation before Draft persistence

Session 12 does not create workflow runs, persist runtime inputs, collect
secret values, resolve secrets, upload files, publish workflows, execute
browser actions, use Playwright, or add AI behavior.

## Session 13: workflow versioning and publish lifecycle

- Framework-independent lifecycle transitions and publish-readiness analysis
- Draft, Testing, Published, and Archived version states
- Immutable Published definitions and revision-preserving lifecycle metadata
- New Draft creation from Published or Archived source versions
- Version history and role-aware web lifecycle controls
- PostgreSQL-enforced single current Published version
- Optimistic revision checks, serializable transactions, Workflow row locks,
  bounded retries, and idempotent Draft creation

Session 13 establishes review and publication state only. Testing does not run
the workflow, and publishing does not deploy or execute it. Execution,
Playwright, environment promotion, version diffing, rollback, and AI review
remain outside this session.

## Session 14: Local Runner foundation and secure pairing

- Framework-independent runner protocol and pairing state
- Human one-time code plus undisplayed high-entropy device code
- Workspace-scoped OWNER/ADMIN approval and runner revocation
- Separate opaque runner identity and credential authentication
- Local atomic credential storage and heartbeat CLI
- Web pairing approval and runner-device status

Session 14 establishes runner identity and connectivity only. It does not
install Playwright, poll for jobs, launch a browser, or execute a workflow.

## Session 15: Playwright execution foundation

- Playwright Library scoped to the Local Runner
- Explicit Chromium-only browser installation
- Strict local request, option, result, and safe-error contracts
- Isolated non-persistent BrowserContext for every execution
- Explicit HTTP/HTTPS origin allowlist and safe navigation
- Deterministic locator mapping with exactly one match
- Sequential Navigate, Click, Fill, Select, SetChecked, and Wait execution
- Fail-fast behavior, resource cleanup, safe reporting, and local fixture

Session 15 executes only caller-supplied validated local workflows. It does not
poll the Control Plane, persist WorkflowRun records, reuse browser profiles,
resolve secrets, capture screenshots or traces, retry, repair locators, or use
AI.

## Session 16: deterministic workflow engine

- Framework-independent workflow execution orchestrator
- Explicit run and step state machines
- Preflight before adapter startup
- Sequential fail-fast execution with typed skipped steps
- Total timeout, step timeout, and idempotent cancellation
- Deterministic termination races and safe progress events
- Complete validated results and guaranteed cleanup reporting
- Playwright retained behind the Local Runner adapter

Session 16 remains local and in-memory. It does not add Control Plane jobs,
WorkflowRun persistence, polling, retry, resume, approval pause, branching,
parallel execution, screenshots, secret resolution, scheduling, or AI repair.

## Session 17: persisted run dispatch

- Framework-independent run protocol
- Published workflow run creation and readiness restrictions
- Transactional run and step persistence
- Assigned Local Runner claims and hashed renewable leases
- Ordered idempotent progress and completion
- Cooperative cancellation and lease-expiry interruption
- Safe run history and detail UI

Session 17 excludes runtime input and secret delivery, automatic retry or
requeue, resume, Redis, WebSocket, scheduling and parallel jobs.

## Session 18: secure run-input delivery

- Framework-independent secure run-input contracts and deterministic AAD
- Runner-generated RSA-OAEP public/private key pair
- Short-lived, idempotent run preparation and encrypted commit
- Browser Web Crypto AES-256-GCM variable encryption
- Ciphertext-only Control Plane persistence and claim delivery
- Runner-only decryption and local no-echo secret provider
- Disposable in-memory runtime values with existing run lifecycle preserved

Session 18 excludes files, persistent secrets, key rotation, OS keychains,
retry/resume, saved browser authentication and AI.

## Session 19: deterministic outcome verification

- Framework-independent verification contracts and semantic analysis
- URL origin and origin-plus-path verification
- Exact and contains text verification
- Visibility, field-value, and checked-state verification
- Bounded cancellable Playwright polling with unique locators
- Value-free results and fail-fast workflow integration
- Runner capability advertisement and dispatch compatibility checks
- Read-only locator editing for explicit Verify steps

Session 19 excludes visual comparison, regex, custom JavaScript, XPath,
automatic verification generation, locator repair, screenshots and AI.

## Session 20: ephemeral workflow outputs

Deterministic Extract steps produce string or boolean values for compatible
later steps. Values remain in Local Runner memory; only safe producer and status
metadata is persisted by the Control Plane.

## Session 21: human approval gates

An Approval Step pauses local execution before its immediate next step. A
Workspace OWNER or ADMIN decides a persisted, run-bound request while the
Runner keeps the lease and isolated browser session alive. Rejection,
expiration, cancellation, lease loss, and Runner revocation fail closed.

## Session 22: conservative retry and attended repair

- Deterministic effect-certainty and retry classification
- One bounded automatic retry for explicitly transient read-only failures
- Optional attended manual repair of the exact failed step
- Safe attempt history and Workspace Repair Center
- Browser-session retention with heartbeat and lease renewal
- Fail-closed abort, expiry, cancellation and invalidation

Session 22 excludes locator editing, step skipping, workflow restart,
uncertain-side-effect retry, crash resume, background retry scheduling and AI
repair.

## Session 23: deterministic locator repair proposals

- Failure eligibility based on safe effect certainty
- Bounded semantic candidates ranked by the existing locator engine
- Privacy filtering before candidate metadata leaves the Runner
- Read-only, page-context-bound candidate tests
- Existing-Draft locator-only application with optimistic concurrency
- Immutable source Published versions and explicit manual publishing

Session 23 excludes active-run overrides, automatic continuation, DOM dumps,
screenshots, XPath, AI repair, automatic Draft creation and publishing.

## Session 24: deterministic execution policy

- Immutable Workspace policy versions with one active revision
- Deterministic origin, action-intent, risk and decision evaluation
- Immediate Approval binding for gated actions, with deny precedence
- Authoring, publish, run-creation and locator-repair validation
- Policy-pinned runs, stale queued-run rejection and Runner defense in depth
- Structured Workspace Policy Settings and safe run metadata

Session 24 excludes policy scripts, OPA/Rego, AI classification, automatic
workflow edits, live policy mutation and an emergency kill switch.

## Session 25: append-only audit trail

- Hash-chained, workspace-scoped audit events with PostgreSQL trigger
  immutability
- Same-transaction appender invoked from workflow, policy, run, approval,
  repair and locator-repair mutations
- Canonical JSON + SHA-256 chain verification with typed `ok`, `sequence_gap`
  and `tampered` results
- Typed payload schemas enforcing a shared forbidden-key list at every
  boundary
- Safe run-evidence endpoint that returns only typed workflow-run lifecycle
  events
- API endpoints for list, detail, verify and run evidence with strict
  role-based authorization
- Web audit pages (list, detail, verify) and a typed Evidence tab on the
  run detail page

Session 25 excludes external SIEM forwarding, long-term archival, granular
per-actor retention, HSM-backed signing and compression of large payloads.

## Session 26: safe scheduled workflow runs

- Database-backed scheduler polling every 30 seconds for due ACTIVE schedules.
- Framework-independent `packages/workflow-scheduling` with Zod schemas, DST-aware
  occurrence calculation, and unattended readiness analysis.
- Three structured schedule types: `one_time`, `daily` (every N days), and
  `weekly` (weekdays every N weeks), all using validated IANA timezone
  identifiers.
- DST semantics: nonexistent local times are skipped, ambiguous times use the
  earlier UTC instant.
- Occurrence idempotency via unique `[scheduleId, scheduledFor]` constraint;
  active run guard via unique `[scheduleId]` for active scheduled runs.
- Multi-instance scheduling with `FOR UPDATE SKIP LOCKED` and serializable
  transactions — no Redis or in-memory mutex.
- Start window (default 5 minutes) with `missed_start_window` policy.
- Policy re-evaluation at every occurrence: policy change, denial, or approval
  gate skips the occurrence and auto-pauses the schedule.
- Ambiguous outcome protection: INTERRUPTED or unknown-side-effect runs
  auto-pause the schedule; OWNER or ADMIN must review and resume.
- `scheduled_execution_v1` capability advertised only in unattended headless mode;
  scheduled runs exclude approval steps, manual repair, and locator repair.
- Audit events for schedule lifecycle and occurrence lifecycle.

Session 26 excludes cron expressions, RRULE, runtime inputs and secrets in
schedules, approval steps, manual repair, locator repair, backfill, catch-up,
and Run Now.

## Browser-first MVP direction

Later sessions may address these capabilities individually after their
requirements and safety boundaries are approved:

1. Reviewable workflow representation and editing
2. Policy and authorization decisions
3. Deterministic local browser execution
4. Control-plane coordination and durable product data

The sequence is intentionally review-led: recording, planning, approval, and
execution are separate concerns.

## Not part of Session 01

Session 01 does not include a database, authentication, Redis, BullMQ,
Playwright, browser recording, workflow execution, AI integration, cloud
deployment, CI/CD, Docker, React Flow, or business database models. Dependencies
for those capabilities will be evaluated only in the session that implements
them.

# Session 27: Operational notifications

Implemented the in-app operational alert foundation: strict safe templates, transactional outbox, membership routing, crash-safe multi-worker delivery, bounded retry/dead letter, unread count, Notification Bell and Inbox. External channels, preferences, recurring reminders, digests, escalation and manual dead-letter replay remain future work.

# Session 28: Privacy-safe operational telemetry

Implemented separate API liveness/readiness, database-time component heartbeats, fixed-window Workspace operational snapshots and a Workspace Operations Dashboard. Aggregates cover component health, Runner capacity, runs, Approvals, Repairs, Schedules, notification delivery and authoritative Audit integrity without collecting workflow business or runtime data.

Session 28 excludes public Prometheus metrics, Grafana, OpenTelemetry, distributed tracing, external APM, infrastructure auto-alerting, business analytics and user-defined windows.

# Session 29: Local Secret Store

Implemented encrypted Local Runner secret storage for unattended scheduled workflows, safe inventory synchronization, revision rollback protection, readiness/occurrence checks and claim-time inventory pinning. The Control Plane remains outside the plaintext boundary.

Web secret entry/reveal/export, environment fallback, cloud providers, automatic OS unlock, secret sharing, binary material, master-key rotation and forensic erasure guarantees remain future work.

# Session 30: Windows production Runner service

Implemented explicit Interactive, Unattended Process and Windows Service modes;
truthful process-unattended versus boot-resilient autonomy; one-process local
locking; bounded reconnect; graceful drain; non-resumable crash recovery; and
strict safe runtime metadata in Runner Detail.

Added explicit passphrase-to-Windows-native protector migration with candidate
reopen verification and DPAPI-NG startup auto-unlock. Existing Session 29
process-unattended schedules remain compatible. macOS/Linux services and native
protectors, MSI/Authenticode, auto-update, durable run resume, remote service
management, master-key rotation and secret backup remain out of scope.

# Session 31: Signed production Runner releases

Implemented framework-independent release identity, explicit protocol/schema
compatibility and non-mutating upgrade preflight; controlled Windows x64
allowlist packaging; canonical SHA-256 release manifests with detached Ed25519
signatures and a rotation-ready trusted public-key registry; local
version/verify/preflight
commands; safe heartbeat identity, claim and Schedule compatibility gates;
Runner Detail status; idempotent software-version audit; and immutable
tag-triggered release plus secret-free dry-run workflows.

Automatic download/install/update, automatic rollback or state migration,
remote update execution, MSI, Authenticode, macOS/Linux/ARM artifacts, delta
updates, SBOM, SLSA provenance and Control Plane release-catalog synchronization
remain out of scope.

# Session 32: Secure local Runner update and rollback

Implemented a framework-independent update decision package and a local
Windows x64 controller that verifies signed release proof before mutation,
requires forward and projected rollback compatibility, blocks schema migration,
uses an exclusive update lease, drains active work without cancellation,
extracts into an allowlisted versioned staging layout, switches an explicit
per-release service activation, verifies actual local startup health and
recovers deterministically from an atomic journal.

The previous verified release is retained. Failed target health triggers
automatic rollback only after proof and compatibility are rechecked against
current state; ambiguous or unsafe cases enter `manual_recovery_required`.
Update maintenance blocks claims and skips one scheduled occurrence without
backfill or unnecessary Schedule auto-pause. Control Plane outage alone does
not invalidate local health.

Automatic discovery/download, background or silent update, remote/fleet
rollout, remote rollback/shell, forced update, schema or vault migration,
arbitrary install scripts, MSI/Authenticode, delta patches and non-Windows-x64
targets remain out of scope. Existing unmanaged installations require a
separately controlled bootstrap before using this controller.
