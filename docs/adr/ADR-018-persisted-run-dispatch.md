# ADR-018: Persisted run dispatch with renewable leases

- Status: Accepted
- Date: 2026-07-31

## Context

The workflow engine can execute safely in memory, but TaskTwin needs a durable
Control Plane record and a bounded way for one paired Local Runner to claim
work without turning runner credentials into unlimited job authority.

## Decision

Create `@tasktwin/run-protocol` and persist WorkflowRun, WorkflowRunStep and
progress-batch receipts. Runs originate only from immutable Published
WorkflowVersions that require no runtime inputs, files, secrets or unsupported
steps. The server derives HTTP/HTTPS origins from literal Navigate steps.

Each run is assigned to one non-revoked RunnerDevice in the same Workspace.
Runner credentials authenticate the device. A separate HMAC-derived
short-lived lease authorizes one run; PostgreSQL stores only its keyed hash.
Claim-attempt IDs make a lost claim response exactly retryable.

Progress uses monotonic sequences and immutable client batch IDs. A serializable
transaction validates transitions, stores the batch digest and updates the run
and step projections. Completion validates the complete workflow-engine result
against source step order before making the run terminal.

Cancellation is cooperative. Lease expiry produces Interrupted, preserves
completed steps, safely terminates the active step and skips unattempted steps.
Interrupted runs are never requeued.

## Consequences

PostgreSQL-specific locks and a partial unique index enforce one active run per
Runner. Lazy expiry means an untouched expired run is finalized when claim,
renewal, progress, completion or read activity reaches it. Runner crashes can
lose unflushed in-memory progress, after which the lease expires safely.

Runtime input, file and secret delivery, retry, resume, scheduling, parallel
jobs, Redis and WebSocket remain future decisions.
