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

## Browser-first MVP direction

Later sessions may address these capabilities individually after their
requirements and safety boundaries are approved:

1. Explicit browser recording controls and a minimal event contract
2. Reviewable workflow representation
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
