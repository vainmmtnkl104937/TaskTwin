# TaskTwin AI Agent Instructions

TaskTwin is a local-first browser workflow automation platform. The Control
Plane coordinates trusted metadata and work; browser execution and sensitive
runtime behavior remain on the user's Runner.

## Default context

For a normal task, read only this default set first:

1. `AGENTS.md`
2. `docs/ai/PROJECT_CONTEXT.md`
3. `docs/ai/CURRENT_STATE.md`
4. `docs/ai/MODULE_MAP.md`
5. `docs/ai/INVARIANTS.md`

Then inspect only the code, schemas, migrations and tests relevant to the task.
Do not read `docs/sessions/*` or every ADR by default. Historical session and
ADR documents are on-demand references: open one only when a concrete design
question remains unresolved after inspecting current code and the default
context. Code, schemas, migrations and tests are the implementation source of
truth.

## Engineering rules

- Preserve the requested scope and unrelated user changes.
- Use TypeScript strict mode. Avoid `any`; document a genuine exception.
- Validate external input at every system boundary.
- Reuse existing contracts and abstractions before creating new ones.
- Keep domain packages framework-independent where they are currently designed
  that way.
- Prefer deterministic behavior over free-form agent behavior.
- Do not add dependencies unless necessary and explained.
- Never edit an old Prisma migration; create a new migration.
- Add or update tests for behavior changes.
- Update relevant current documentation when architecture or behavior changes.
- Never silently repair or alter a production workflow.

## Durable product and security rules

- Published `WorkflowVersion` records are immutable.
- AI suggestions cannot bypass policy or human authorization.
- Policy deny wins; approval never overrides deny.
- Plaintext local secrets never reach the Control Plane. Do not put secrets,
  runtime inputs or ephemeral output values in Audit, Alerts or Telemetry.
- Crashed `WorkflowRun` instances are not silently resumed; expired run leases
  are not reused.
- There is no remote shell or arbitrary Control Plane command execution.
- Unsigned Runner software metadata is never trusted.
- Runner update uses verify-before-mutate; unsafe rollback is blocked.
- Fleet desired version is declarative metadata, never an install/update/
  rollback command.

See `docs/ai/INVARIANTS.md` for the complete compact invariant set.

## Working method

Before coding:

1. Read the default context files.
2. Inspect only relevant modules and tests.
3. Identify existing abstractions, risks and assumptions.
4. Produce a concise file-level plan.
5. Do not edit code until the user has authorized implementation.

After coding:

1. Run relevant tests.
2. Run lint.
3. Run typecheck.
4. Run build when applicable.
5. Report files, dependencies, tests, commands, exact results, security
   considerations and limitations. Never claim an unexecuted check passed.

## AI context maintenance

After a future completed session, update only:

- `docs/ai/CURRENT_STATE.md` when current capabilities change;
- `docs/ai/MODULE_MAP.md` when modules are added or removed;
- `docs/ai/INVARIANTS.md` only when a durable invariant changes;
- `docs/ai/SESSION_INDEX.md` with one compact line.

`docs/ai/PROJECT_CONTEXT.md` should change rarely. Change `AGENTS.md` only for
durable agent-working rules. Compress these files when they grow beyond their
purpose; never append full session completion reports.
