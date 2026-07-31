# Session 16: deterministic workflow engine

## Goal

Session 16 extracts execution orchestration from the Local Runner into the
framework-independent `@tasktwin/workflow-engine` package. Playwright remains
behind a Local Runner adapter.

## Included

- Strict execution request, progress, error, warning, and result contracts
- Explicit run and step state machines
- Preflight before adapter startup
- Sequential execution in `WorkflowDefinition.steps` order
- One running step and fail-fast behavior
- Typed skipped results for every unattempted step
- External AbortSignal cancellation
- Bounded total timeout and separate step timeout
- Deterministic termination-race arbitration
- Safe progress sink with non-terminal sink-failure warning
- Adapter cleanup after every startup attempt
- Complete runtime-validated final results and count invariants
- Local Runner Playwright adapter, safe CLI progress, and stable exit codes

## Engine and Playwright boundary

The engine validates workflow structure, runtime inputs, secret requirements,
origins, supported steps, timeout bounds, and adapter-specific static checks.
It owns no Browser, BrowserContext, Page, Locator, filesystem, database, or
application-framework object.

The Local Runner adapter owns Chromium startup, isolated non-persistent
contexts, locator resolution, Playwright actionability, post-navigation origin
checks, browser error mapping, and browser cleanup.

## Lifecycle semantics

Runs have explicit pending, validating, starting, running, cancelling, and
terminal states. Steps have pending, running, and terminal states. Invalid
transitions fail with typed deterministic errors. A failure, cancellation, or
timeout stops later actions; every remaining step becomes skipped with a typed
reason.

The total deadline starts immediately before adapter startup and covers startup
plus all steps. Effective step timeout is the smaller of configured step
timeout and remaining total budget. Step timeout fails the run; total deadline
expiration produces `timed_out`.

Termination candidates are ordered by monotonic time. An exact tie uses
`total_timeout`, then cancellation, then adapter failure. Only one cause may be
locked.

## Progress, results, and cleanup

Progress events expose only execution/step identifiers, type, status,
timestamp, and safe codes. A broken progress sink is disabled after its first
failure and becomes a warning; browser effects are never repeated.

Final results include every source step, terminal status, timestamps, category
counts, one termination cause, an applicable failed step ID, and safe warnings.
They exclude runtime values, secrets, complete URLs, raw locators, DOM data,
Playwright objects, and raw errors.

Adapter stop is awaited after startup begins. A cleanup error is reported as a
warning while preserving an earlier primary failure. Cleanup failure after
otherwise successful execution safely fails the run.

## Excluded

There is no WorkflowRun persistence, job delivery, polling, retry, resume,
crash recovery, approval pause, branching, parallel execution, Extract,
Verify, secret resolution, screenshot, trace, video, scheduling, or AI repair.
