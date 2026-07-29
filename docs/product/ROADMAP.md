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

## Browser-first MVP direction

Later sessions may address these capabilities individually after their
requirements and safety boundaries are approved:

1. Explicit browser recording controls and a minimal event contract
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
