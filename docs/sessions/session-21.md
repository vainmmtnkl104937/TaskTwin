# Session 21: Human approval gates

## Included

Session 21 adds deterministic, run-bound approval of the immediate next
workflow step. The framework-independent approval package analyzes bindings and
owns lifecycle contracts. The Workflow Engine pauses without calling the
browser adapter. The Local Runner keeps its browser session, heartbeat, and run
lease active while polling the Control Plane.

PostgreSQL persists request identity, safe risk, binding, expiry, status, and
decision metadata. The server derives display metadata from the immutable
Published WorkflowVersion. OWNER and ADMIN may decide; all Workspace roles may
read safe metadata. Exact retries are idempotent and concurrent decisions have
one atomic winner.

The Workflow Editor exposes message, risk, timeout, read-only next-step scope,
and the derived gated step. The Approval Center exposes safe requests and
role-gated decisions. Run and step contracts include
`waiting_for_approval`.

## Safety behavior

Approval resumes once. Rejection cancels without executing the gated step.
Expiry times out. User cancellation cancels a pending request. Lease expiry or
Runner revocation invalidates it and preserves Interrupted behavior. Progress,
results, APIs, logs, and storage exclude runtime inputs, secrets, outputs, raw
locators, complete URLs, and browser state.

## Excluded

Email or offline approval, links, notifications, comments, attachments,
quorum, approver groups, chained policies, workflow-wide approval, workflow or
input modification, persistent browser pause, crash resume, automatic requeue,
AI decisions, and policy-engine insertion are excluded.
