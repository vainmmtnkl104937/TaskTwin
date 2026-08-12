# TaskTwin Module Map

Use this map to choose the smallest code area to inspect. Application packages
own framework/platform adapters; most packages under `packages/` own reusable
contracts or deterministic domain decisions.

## Applications

- `apps/web` — Next.js Control Plane UI for authentication, workspaces,
  workflow review, runs, governance, operations and Runner fleet views.
- `apps/api` — NestJS Control Plane HTTP boundary plus the separate Scheduler
  process entrypoint, authorization, orchestration and repository integration.
- `apps/api/src/http-security` — production HTTP headers, correlation IDs,
  bounded errors/log redaction and scoped abuse protection without changing
  domain authentication guards.
- `apps/extension` — Manifest V3 Chrome Recorder, DOM/privacy adapters, local
  recording state, artifact archive and sync outbox.
- `apps/local-runner` — authenticated local worker, Playwright adapter, CLI,
  local crypto/filesystem adapters and Windows service/update integration.
- `apps/notification-worker` — non-HTTP transactional outbox consumer for
  crash-safe in-app notification delivery.
- `docker/control-plane.Dockerfile` and `compose.production.yaml` — separate
  production Control Plane images, migration-gated startup, health wiring,
  persistent PostgreSQL and reverse-proxy-ready networks.
- `deploy/control-plane/dr`, `deploy/control-plane/compose.dr.yaml` and
  `docs/disaster-recovery.md` — deterministic PostgreSQL backup, clean restore,
  retention, restored-state verification and the repeatable DR drill.

## Recording and privacy

- `packages/recording-schema` — strict recording event, artifact, privacy
  summary and synchronization contracts.
- `packages/recording-converter` — deterministic completed-recording to Draft
  workflow conversion and provenance reporting.
- `packages/locator-engine` — pure semantic locator scoring, ranking,
  confidence and dynamic-identifier rules.
- `packages/privacy-engine` — deterministic sensitivity classification,
  sanitization policy and redaction-plan geometry.

## Workflow authoring and lifecycle

- `packages/workflow-schema` — versioned workflow definition and step schemas;
  the runtime validation source of truth.
- `packages/workflow-editor-core` — immutable Draft editing operations and
  deterministic linear graph projection.
- `packages/workflow-inputs` — variable, value-source, secret-reference and
  temporary run-input compatibility analysis.
- `packages/workflow-lifecycle` — lifecycle transitions, publish readiness and
  immutable versioning decisions.
- `packages/workflow-extraction` — Extract output contracts, producer/consumer
  ordering and value-type compatibility.

## Execution and coordination

- `packages/workflow-engine` — framework-independent sequential execution
  state machines, preflight, timeout, cancellation and safe results.
- `packages/run-protocol` — persisted run claim, lease, progress, completion
  and cancellation contracts.
- `packages/runner-protocol` — Runner pairing, authentication, heartbeat,
  software/runtime metadata and safe Control Plane acknowledgement contracts.
- `packages/secure-run-inputs` — encrypted run-preparation envelopes, AAD,
  Runner key contracts and plaintext-local payload validation.
- `packages/workflow-verification` — deterministic Verify rules, normalization,
  polling decisions and safe value-free outcomes.
- `packages/workflow-approval` — immediate-next-step approval binding,
  lifecycle and safe summaries.

## Policy and recovery

- `packages/workflow-policy` — immutable Workspace policy contracts, origin and
  action-risk evaluation, deny/approval decisions and canonical digests.
- `packages/workflow-recovery` — effect certainty, bounded safe retry,
  attended-repair state and fail-closed recovery contracts.
- `packages/workflow-locator-repair` — eligible locator proposal ranking,
  privacy constraints, read-only testing and Draft-only patch decisions.

## Scheduling and operations

- `packages/workflow-scheduling` — schedule contracts, IANA timezone/DST
  occurrence calculation and unattended readiness decisions.
- `packages/audit-trail` — typed safe audit events, canonical hashing,
  append-only chain construction and verification.
- `packages/operational-alerts` — bounded action-required alert contracts,
  deduplication keys, routing and safe templates.
- `packages/operational-telemetry` — component health, fixed-window aggregate
  snapshots, freshness and low-cardinality operational summaries.

## Runner lifecycle and secrets

- `packages/local-secret-store` — portable encrypted vault, inventory, pinning,
  AAD and protection-profile contracts; platform crypto remains in the Runner.
- `packages/runner-service-runtime` — platform-neutral Runner modes, autonomy,
  reconnect, drain, lifecycle and capability derivation.
- `packages/runner-release` — signed release identity, manifest/signature trust,
  compatibility and upgrade-preflight contracts.
- `packages/runner-acquisition` — pure trusted-source, acquisition, partial
  resume, verified-cache and safe-summary contracts; network and filesystem
  adapters remain in the Local Runner.
- `packages/runner-update` — pure local update/rollback planning, health,
  recovery and retention decisions.
- `packages/runner-rollout` — release catalog status, compliance, staged rollout,
  conflict, convergence and rollback-observation logic.

## Persistence and foundation

- `packages/database` — Prisma schema/client boundary and framework-independent
  repositories for Control Plane persistence, transactional mutations and
  offline restored-database/audit verification.
- `packages/shared-types` — small cross-application shared contracts such as
  service health.
- `packages/config` — shared strict TypeScript and ESLint configuration.

## Inspection shortcuts

- HTTP/RBAC issue: start in `apps/api`, then the relevant database repository
  and domain package.
- UI issue: start in `apps/web`, then its server Control Plane client and shared
  contracts.
- Browser execution issue: start in `apps/local-runner`, then
  `workflow-engine` and the relevant domain package.
- Recorder issue: start in `apps/extension`, then `recording-schema`,
  `privacy-engine` or `locator-engine`.
- Persistence issue: inspect `packages/database/prisma/schema.prisma`, only the
  newest relevant migration, the repository and its tests.
