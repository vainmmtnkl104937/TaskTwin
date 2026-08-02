# TaskTwin Workflow Engine

`@tasktwin/workflow-engine` is the framework-independent deterministic
orchestrator for validated TaskTwin workflows.

It owns strict execution contracts, preflight validation, run and step state
machines, sequential fail-fast orchestration, total timeout, cancellation,
typed skipped results, safe progress events, deterministic termination races,
cleanup reporting, and complete final results.

The engine depends only on framework-independent packages and Zod. It does not
import Playwright or application frameworks. Browser behavior is provided
through `WorkflowExecutionAdapter`; the Local Runner implements that contract
with Playwright.

## Lifecycle

Runs move through `pending`, `validating`, `starting`, `running`, and optional
`cancelling` states before exactly one terminal state. Steps move from
`pending` to `running` or `skipped`, then to one terminal state. Only one step
may run at a time and every source step appears in the final result.

Total timeout covers adapter startup and step execution. A step timeout fails
the run with `step_timeout`; expiration of the total deadline produces
`timed_out`. Cancellation, timeout, and adapter errors use a deterministic
timestamp and tie-priority rule.

Progress and results contain identifiers, statuses, timestamps, fixed error
codes, counts, safe warnings, and output metadata only. Runtime values,
secrets, full URLs, locators, framework objects, and raw errors are excluded.

Verify steps return only value-free verification metadata through the generic
adapter result. Extract steps may return a value only across the private
adapter boundary. The engine stores it in a per-run `RuntimeOutputStore`,
allows one production per declared output, resolves it only for compatible
later steps, emits metadata-only progress, and clears the store on every
terminal path.

## Verification

```powershell
pnpm --filter @tasktwin/workflow-engine lint
pnpm --filter @tasktwin/workflow-engine typecheck
pnpm --filter @tasktwin/workflow-engine test
pnpm --filter @tasktwin/workflow-engine build
```

Default tests use fake adapters and an injected clock; Chromium is not needed.

## Approval coordination

Approval steps are handled by an injected `WorkflowApprovalCoordinator`, not
the browser adapter. The run and Approval Step enter `waiting_for_approval`;
approval resumes sequential execution, rejection cancels, expiry times out,
and invalidation interrupts. Progress contains only safe IDs, risk, status,
decision, and timestamps.

## Recovery coordination

The engine classifies safe failures through `@tasktwin/workflow-recovery`.
Only transient read-only Verify and Extract failures receive one automatic
retry. Optional manual repair uses an injected `WorkflowRecoveryCoordinator`;
the engine enters `waiting_for_repair`, executes no later step, and retries
only the exact current step after an approved request. Abort, expiry,
cancellation and invalidation preserve cleanup and sensitive-state disposal.
Progress and results expose bounded attempt metadata only.
