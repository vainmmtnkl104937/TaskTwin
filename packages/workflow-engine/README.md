# TaskTwin Workflow Engine

`@tasktwin/workflow-engine` is the framework-independent deterministic
orchestrator for validated TaskTwin workflows.

It owns strict execution contracts, preflight validation, run and step state
machines, sequential fail-fast orchestration, total timeout, cancellation,
typed skipped results, safe progress events, deterministic termination races,
cleanup reporting, and complete final results.

The engine depends only on `workflow-schema`, `workflow-inputs`, and Zod. It
does not import Playwright or application frameworks. Browser behavior is
provided through `WorkflowExecutionAdapter`; the Local Runner implements that
contract with Playwright.

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
codes, counts, and safe warnings only. Runtime values, secrets, full URLs,
locators, framework objects, and raw errors are excluded.

## Verification

```powershell
pnpm --filter @tasktwin/workflow-engine lint
pnpm --filter @tasktwin/workflow-engine typecheck
pnpm --filter @tasktwin/workflow-engine test
pnpm --filter @tasktwin/workflow-engine build
```

Default tests use fake adapters and an injected clock; Chromium is not needed.
