# Session 10: Deterministic recording-to-workflow conversion

## Goal

Convert one completed, validated recording artifact into a persisted version 1
draft workflow while retaining deterministic provenance, warnings, unresolved
events, and idempotency.

## Included

- Framework-independent `@tasktwin/recording-converter`
- Strict conversion options, result, mapping, issue, and report contracts
- Deterministic event ordering, step IDs, names, variable names, and issue order
- `setChecked` workflow step for checkbox and radio state
- Recording-event to workflow-step conversion
- Masked-personal variables and secret-reference-only password handling
- Conservative exact-consecutive deduplication
- Blocking unresolved-event and publishable reporting
- `RecordingWorkflowConversion` Prisma persistence and migration
- Authenticated organization-scoped workflow-draft creation endpoint
- Transactional Workflow, WorkflowVersion, and receipt creation
- Database-backed idempotent retries

## Recording versus workflow

A recording artifact is immutable evidence of sanitized browser interactions.
It contains event identity, sequence, current-page locator evidence, privacy
decisions, and the values that policy explicitly allowed. It is not directly
executable.

A workflow definition is an ordered plan. Conversion creates only steps that
can be represented deterministically and safely. The original recording is
preserved and the conversion report records what happened to every source
event.

## Mapping behavior

- Click becomes `click`.
- Allowed complete text input becomes `fill` with a literal.
- Masked personal input becomes `fill` with a required workflow variable.
- A replayable blocked password becomes `fill` with a secret reference name.
- Allowed select becomes `select` using the selected option value.
- Checkbox state becomes `setChecked` with its resulting boolean.
- Selected radio state becomes `setChecked` with `true`.

Schema-valid masked state, truncated values, and blocked values that cannot be
represented safely remain unresolved. A malformed or unsupported event rejects
the complete source with stable blocking input issues before workflow
generation. Low locator confidence creates a warning. The converter never
creates a locator, promotes a non-unique fallback, reconstructs a value, or
stores a secret.

## Determinism and provenance

Source sequence is authoritative. Emitted steps use `step-001`, `step-002`,
and so on after conservative deduplication. Names and identifiers derive only
from bounded, sanitized structural metadata with fixed fallback and collision
rules.

Every source event has one conversion mapping. Converted mappings retain the
step ID and recorded locator bundle. Deduplicated mappings identify the
retained event and step. Unresolved mappings contain stable issue codes, not a
raw event or payload.

`publishable: false` means at least one blocking conversion issue exists. It
does not prevent a non-empty workflow from being stored as `draft` for later
review, and it never causes publishing in this session.

## Persistence and API

`POST /recording-sessions/:recordingSessionId/workflow-drafts` accepts a client
conversion UUID, workflow name, and optional description. It requires a
completed recording and current OWNER, ADMIN, or MEMBER organization access.
Cross-organization resources remain hidden and VIEWER is rejected.

The generated Workflow inherits the recording's workspace. Workflow,
WorkflowVersion version 1 with status `draft`, and conversion receipt are
created in one serializable transaction. Exact retry is idempotent through the
unique `(recordingSessionId, clientConversionId)` constraint. The response is a
safe count-and-identifier summary and does not expose events, payloads,
locators, or captured values.

## Current limitations

- An empty or entirely unresolved recording cannot produce a valid workflow
  because workflow version 1 requires at least one step.
- The artifact stores an origin, not a complete navigation URL, so conversion
  does not infer a navigate step.
- Recording version 3 already rejects missing locators and unchecked radio
  events before conversion.
- Locator confidence describes capture-time evidence, not future stability.
- Variables and secret references are contracts only; no editor, secret store,
  or execution binding is implemented.

## Excluded

- Next.js workflow editor and React Flow
- Manual step editing
- Workflow publishing
- AI naming, analysis, or repair
- Playwright and local-runner changes
- Wait or assertion generation
- Screenshot processing
- Locator repair
- Redis and BullMQ
