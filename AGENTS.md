# TaskTwin AI Agent Instructions

You are working on TaskTwin, a local-first browser workflow automation platform.

## Core architecture

TaskTwin contains:

* `apps/web`: Next.js dashboard
* `apps/api`: NestJS control-plane API
* `apps/extension`: Chrome Extension recorder
* `apps/local-runner`: local Node.js and Playwright execution service
* `packages/workflow-schema`: shared workflow contracts and validation
* `packages/workflow-engine`: deterministic workflow execution logic
* `packages/locator-engine`: semantic browser locator logic
* `packages/policy-engine`: action risk and authorization rules
* `packages/shared-types`: shared TypeScript types

The API is the control plane. Browser automation runs locally on the user's machine.

## Working rules

1. Inspect the repository and relevant documentation before changing code.
2. Do not modify files outside the current task's scope.
3. Do not introduce a new dependency unless it is necessary and explained.
4. Use TypeScript strict mode.
5. Do not use `any` unless there is a documented technical reason.
6. Validate external input at system boundaries.
7. Keep domain logic independent from UI and framework code.
8. Prefer deterministic execution over free-form AI behavior.
9. Never store passwords, cookies, access tokens, OTPs or other secrets in source code, logs, screenshots or recording events.
10. AI-generated suggestions must never bypass policy checks or human approval.
11. Published workflow versions must be immutable.
12. Write or update tests for changed behavior.
13. Run lint, typecheck, tests and build before reporting completion.
14. Update relevant documentation when behavior or architecture changes.
15. Never silently repair or change a production workflow.

## Implementation process

Before implementation:

* Summarize your understanding.
* Inspect existing code.
* Propose a file-level implementation plan.
* Identify risks and assumptions.
* Do not edit code until explicitly instructed to implement.

After implementation, report:

* Summary of changes
* Files created or modified
* Dependencies added or removed
* Tests added
* Commands executed
* Test, lint, typecheck and build results
* Security considerations
* Remaining limitations
* Recommended manual test steps

Do not claim success when a required command has not been executed successfully.
