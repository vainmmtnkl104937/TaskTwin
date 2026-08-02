# ADR-023: Conservative retry and attended manual repair

## Status

Accepted

## Context

Browser failures may occur before an action, during a read-only observation,
or after a side effect may have happened. Treating all failures as retryable
can duplicate submissions, overwrite fields, or repeat approvals.

## Decision

Use a framework-independent recovery package with a fixed safety matrix.
Unknown certainty defaults to never retry. Only explicitly transient read-only
Verify and Extract failures receive one automatic retry. Other eligible
pre-action or read-only failures may pause for one attended manual retry when
the run selects that mode and the headed Runner advertises the capability.

Retry repeats only the current immutable step in the existing isolated browser
session. The Control Plane derives eligibility, persists safe metadata,
requires a valid Runner lease, and resolves decisions atomically. Every manual
retry references an approved request. Approval-gated and possibly
side-effecting actions require a new WorkflowRun.

## Consequences

Recovery is intentionally conservative and may require aborting work that a
human could judge safe. Manual browser changes are not fully audited. Browser
restart, locator editing, workflow restart, crash resume, scheduled retries
and AI repair remain outside this decision.
