# ADR-017: Deterministic workflow engine

- Status: Accepted
- Date: 2026-07-30

## Context

Session 15 proved isolated local Chromium actions but kept validation,
lifecycle, timeout, cancellation, and reporting inside the Playwright-facing
Local Runner. Later execution transports need one deterministic orchestration
contract without importing browser or application frameworks.

## Decision

Create `@tasktwin/workflow-engine` as a framework-independent adapter-driven
orchestrator. The workflow steps array is the sole execution-order source.
Preflight must complete before adapter startup. Only one step may run, the first
failure stops execution, and every source step receives a terminal result.

Run and step transitions are explicit and terminal states are immutable.
External cancellation is idempotent. A bounded total deadline covers adapter
startup and steps; each effective step timeout is capped by remaining total
budget. Step timeout and total timeout remain distinct.

Termination candidates use monotonic timestamps. The earliest wins; exact ties
prefer total timeout, then cancellation, then adapter failure. One winner is
locked.

Progress events and final reports use strict safe contracts. Progress-sink
failure is a warning and disables further delivery rather than replaying a
browser effect.

The adapter is stopped after every startup attempt. Cleanup failure preserves
an earlier primary error; cleanup failure after successful steps safely fails
the run.

Playwright remains in `apps/local-runner` through
`PlaywrightWorkflowExecutionAdapter`. The adapter owns browser lifecycle,
locators, actionability, and Playwright error mapping.

## Consequences

The default engine suite uses fake adapters and an injected clock without
Chromium. Browser integration remains explicit. Execution is currently
in-memory and cannot resume after process loss. Persistence, job delivery,
retry, approval pause, parallelism, secret resolution, and AI repair require
separate decisions.
