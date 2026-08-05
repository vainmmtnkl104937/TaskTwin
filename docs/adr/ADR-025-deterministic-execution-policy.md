# ADR-025: Deterministic execution policy

## Status

Accepted.

## Decision

TaskTwin uses a framework-independent, versioned Workspace policy definition.
All matching rules are aggregated; `deny` outranks `require_approval`, which
outranks `allow`, and the highest risk wins. Blocked origins always outrank
allowed origins. Unknown action intent is explicit and never low risk.

Policy definitions are canonicalized and SHA-256 digested at application
boundaries. Publish and run creation load the active policy server-side. Runs
pin an immutable policy version; the Runner independently validates digests and
decisions before browser launch and enforces origins at runtime.

## Consequences

Policies cannot contain executable code or AI decisions. Required approval is
satisfied only by the existing immediate preceding Approval Step, and approval
cannot override a denial. Updating policy does not interrupt an active run;
cancellation or Runner revocation is required.
