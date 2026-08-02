# Session 22: Conservative retry and attended manual repair

## Included

Session 22 adds `@tasktwin/workflow-recovery`, deterministic effect-certainty
classification, bounded attempt histories, one safe automatic retry for
explicitly transient Verify or Extract failures, and optional attended manual
repair. Manual repair retries only the exact immutable failed step and never
restarts or skips the workflow.

The Workflow Engine owns retry orchestration through an injected coordinator.
The Local Runner advertises `workflow_manual_repair_v1` only when both headed
and attended, retains the same isolated browser session, continues heartbeat
and lease renewal, and performs no automated browser action while waiting.

PostgreSQL adds `WorkflowRunStepAttempt`, `WorkflowRepairRequest`, and
`WAITING_FOR_REPAIR` states. Runner requests require the assigned Runner and a
valid lease. The server derives retry eligibility from the immutable Published
definition and fixed policy. OWNER and ADMIN may Retry; OWNER, ADMIN and MEMBER
may Abort; every Workspace role may read safe metadata.

## Safety model

Effect certainty is one of `not_started`, `read_only`,
`side_effect_possible`, `completed`, or `unknown`. Unknown and possible side
effects are never retried. Click, Fill, Select, SetChecked and Navigate never
retry automatically. Manual retry is limited to a read-only failure or a
failure known to occur before the action starts, one manual retry maximum and
three total attempts maximum. An approval-gated action cannot be retried.

Attempts and requests contain only safe codes, IDs, status, bounded timestamps
and certainty. Runtime inputs, secret values, ephemeral outputs, raw errors,
locators, full URLs, page content and screenshots never enter recovery events,
API responses, logs or persistence.

Expiry times out the run, cancellation closes the browser, and lease loss or
Runner revocation invalidates the request and interrupts the run. A cleanup
failure does not replace the primary execution failure.

## Excluded

Locator editing or suggestions, workflow patching, Skip, Continue Anyway, Mark
Successful, automatic refresh, browser or workflow restart, retry of uncertain
side effects, retry of approval-gated actions, crash resume, requeue, retry
scheduling, background workers and AI repair are excluded.

## Verification

Default unit tests need neither PostgreSQL nor Chromium. Database verification
is opt-in:

```powershell
pnpm db:up
pnpm db:migrate
pnpm db:status
pnpm workflow-runs:check
```

For attended verification, start the Runner with both flags:

```powershell
pnpm --filter @tasktwin/local-runner start -- --headed --attended
```

Manual page correction is not fully audited. Never type secrets while a repair
is waiting.
