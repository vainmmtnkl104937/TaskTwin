# Run Evidence

Run evidence is the safe, read-only subset of the audit trail that
describes a single workflow run. It is intended for human reviewers and
audit consumers who need to answer "what happened to this run?" without
seeing execution inputs or outputs.

## Contents

`GET /workflow-runs/:workflowRunId/evidence` returns:

* `workflow_run.created` — run initiation.
* `workflow_run.claimed` — runner pickup.
* `workflow_run.started` — execution start.
* `workflow_run.waiting_for_approval` — paused for approval.
* `workflow_run.waiting_for_repair` — paused for repair.
* `workflow_run.cancel_requested` — cancellation requested.
* `workflow_run.succeeded`, `workflow_run.failed`,
  `workflow_run.cancelled`, `workflow_run.timed_out`,
  `workflow_run.interrupted` — terminal state.

## Excluded by Design

The following events are never returned by the run evidence endpoint,
even though they exist in the audit trail:

* `execution.attempt_started`, `execution.attempt_terminal`,
  `execution.verification_completed`, `execution.output_produced` — these
  contain observed values and outputs that are redaction-sensitive.
* Workflow lifecycle events that are not run-scoped.
* Approval, repair and locator-repair events — these have their own
  dedicated endpoints.

## Privacy Boundary

* Payloads contain only the run identifier, workflow version identifier,
  attempt number and outcome. They never include observed/expected
  values, output values, hashes, lengths, secrets, tokens, locators,
  URLs or page content.
* The shared `FORBIDDEN_AUDIT_KEYS` list is re-validated server-side and
  on the web boundary before the response reaches the UI.

## Failure Modes

* Missing or out-of-scope `workflowRunId` returns `404`.
* Cross-workspace runs return `404` to avoid existence leaks.
* Run evidence is read-only; it is never used to mutate the run state.