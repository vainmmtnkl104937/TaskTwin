# ADR-011: Convert completed recordings into draft workflows deterministically

- Status: Accepted
- Date: 2026-07-29

## Context

TaskTwin now stores completed, privacy-validated recording artifacts in the
control plane. A recording is evidence of browser interactions; it is not an
executable workflow. Turning it into a workflow requires explicit handling for
masked or blocked values, stateful controls, locator confidence, duplicate
events, provenance, and events that cannot be represented safely.

The conversion must be repeatable and reviewable. A network model, framework
object, database client, or browser DOM must not influence the same source
artifact differently.

## Decision

TaskTwin uses the framework-independent `@tasktwin/recording-converter`
package. It accepts a fully runtime-validated `RecordingArtifact` and strict
conversion options, then produces a versioned draft workflow result and
conversion report.

The converter:

- Preserves source sequence order.
- Uses deterministic step IDs and safe deterministic names.
- Uses recorded unique primary locators and retains fallback/confidence
  evidence in the report.
- Creates required workflow variables for masked personal input.
- Creates only secret reference names for replayable blocked password input.
- Uses `setChecked` for checkbox and selected-radio state.
- Reports every unresolved and deduplicated event.
- Never reconstructs a masked or blocked value.
- Marks the result non-publishable when any blocking issue exists.

The package reads neither the clock nor randomness. The persistence layer
supplies the workflow identity, so the same artifact and options produce
equivalent workflow content, mappings, and issue ordering.

A conversion receipt links the source recording, client idempotency key,
workflow, workflow version, actor, and validated report. The API creates the
`Workflow`, version 1 `draft` `WorkflowVersion`, and receipt in one serializable
database transaction. A unique `(recordingSessionId, clientConversionId)`
constraint provides the final idempotency boundary.

Authorization is evaluated from current organization membership. OWNER, ADMIN,
and MEMBER may convert a completed recording; VIEWER may not. The new workflow
always belongs to the source recording's workspace.

## Consequences

Recordings remain immutable evidence and workflows remain reviewable plans.
Low-confidence locators can be represented with a warning. Schema-valid unsafe
events remain visible as blocking unresolved entries, while malformed or
unsupported source events reject the complete artifact with stable blocking
input issues instead of being silently omitted. A draft may be stored even when
it is not publishable, provided it has at least one executable step.

An empty or entirely unresolved artifact cannot satisfy the existing workflow
contract's non-empty step requirement. It returns a safe no-executable-steps
result and is not persisted; TaskTwin does not invent a placeholder action.

Recording event version 3 already requires a unique primary locator and permits
only selected radio events. Missing locators and unchecked radio payloads are
therefore invalid source artifacts rather than ordinary persisted conversion
cases.

This decision does not add workflow editing, publishing, execution, Playwright,
AI analysis, wait/assertion inference, locator repair, or screenshot handling.
