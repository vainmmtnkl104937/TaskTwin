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

## Browser-first MVP direction

Later sessions may address these capabilities individually after their
requirements and safety boundaries are approved:

1. Translation from reviewed recording events to workflow drafts
2. Reviewable workflow representation and editing
3. Policy and authorization decisions
4. Deterministic local browser execution
5. Control-plane coordination and durable product data

The sequence is intentionally review-led: recording, planning, approval, and
execution are separate concerns.

## Not part of Session 01

Session 01 does not include a database, authentication, Redis, BullMQ,
Playwright, browser recording, workflow execution, AI integration, cloud
deployment, CI/CD, Docker, React Flow, or business database models. Dependencies
for those capabilities will be evaluated only in the session that implements
them.
