# ADR-022: Human approval gates

## Status

Accepted

## Decision

TaskTwin models approval as a versioned Workflow `approval` step that gates
only its immediate successor. A framework-independent package owns binding and
state rules. Runtime coordination is injected into the Workflow Engine; HTTP
and Playwright remain Local Runner concerns.

The Control Plane persists one request per run and Approval Step, derives safe
metadata from the immutable Published WorkflowVersion, and permits decisions
only from Workspace OWNER or ADMIN users. Conditional updates and unique client
identifiers provide first-decision-wins concurrency and exact-retry idempotency.

The Runner keeps its existing lease and isolated browser session while waiting.
Approval resumes, rejection cancels, expiry times out, and lease loss or Runner
revocation invalidates and interrupts. No runtime value or browser data enters
the approval contract or persistence model.

## Consequences

Approval is explicit, reviewable, deterministic, and fail-closed. The browser
session is not durable: a Runner crash cannot resume an approval wait. Multiple
approvers, comments, notifications, workflow-wide policy, and offline decisions
require later decisions.
