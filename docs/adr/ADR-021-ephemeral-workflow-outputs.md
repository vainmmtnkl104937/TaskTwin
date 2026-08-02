# ADR-021: Keep workflow outputs ephemeral in the Local Runner

## Status

Accepted.

## Context

Later workflow steps need deterministic values observed from the current page,
but returning those values to the Control Plane would expand TaskTwin's privacy
and persistence boundary.

## Decision

Extract steps declare one typed output. Static data-flow analysis requires a
unique producer before every compatible consumer. During execution, values are
stored once in an in-memory RuntimeOutputStore and erased at termination.

The Control Plane persists one WorkflowRunOutput row per declaration, containing
only safe metadata. Produced progress and completion summaries never contain a
value, length, hash, locator, or page URL.

## Consequences

Workflows can reuse page observations locally without disclosing them to the
server. Outputs cannot survive a restart, be inspected from Web, be transformed,
or be returned as workflow results in the current design.
