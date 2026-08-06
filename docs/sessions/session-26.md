# Session 26: Safe Scheduled WorkflowRuns

Session 26 introduces scheduled workflow runs — a database-backed scheduler that
dispatches WorkflowRuns at defined times without cron expressions or arbitrary
scheduling syntax.

## Motivation

TaskTwin workflows automate browser actions that carry real-world consequences.
Scheduling them requires explicit structure rather than free-form cron, so
operators can audit exactly what will run, when, and under what policy.

Goals:
- No cron expressions or RRULE: schedules are intentionally limited to
  one-time, daily, and weekly patterns.
- Safe concurrency: multiple scheduler instances use `FOR UPDATE SKIP LOCKED`
  without Redis or in-memory mutexes.
- Exactly-once dispatch: a unique constraint prevents duplicate occurrences.
- Policy enforcement: every occurrence re-evaluates the current active policy.
- Bounded start window: runs must start within a fixed delay; expired unclaimed
  runs are reconciled to `TIMED_OUT`.
- Ambiguous outcome protection: interrupted or unknown-side-effect runs
  auto-pause the schedule for human review.

## Architecture

### Overview

```
[Scheduler Polls Every 30s]
         |
         v
SELECT due ACTIVE schedules FOR UPDATE SKIP LOCKED
         |
         v
For each due schedule:
  1. Calculate next occurrence (DST-aware)
  2. Check unique [scheduleId, scheduledFor] constraint
  3. Create WorkflowScheduleOccurrence (PENDING)
  4. Create WorkflowRun (DISPATCHED)
  5. All in serializable transaction
```

Key properties:
- Scheduler selects due ACTIVE schedules using `FOR UPDATE SKIP LOCKED`.
- Each occurrence is created at most once (unique constraint).
- Each schedule dispatches at most one WorkflowRun per occurrence.
- All writes happen in serializable transactions.

### Package: workflow-scheduling

`packages/workflow-scheduling` is a framework-independent pure TypeScript package:

- Zod schemas for all schedule definitions and recurrence types.
- DST-aware occurrence calculation using Luxon.
- Unattended readiness analysis: evaluates whether a schedule can safely
  dispatch based on workflow inputs, secrets, approvals, and policy.
- No NestJS, Prisma, Playwright, or browser dependencies.

### Schedule Types

| Type       | Fires                                           | Parameters                              |
|------------|-------------------------------------------------|-----------------------------------------|
| `one_time` | Once at a specific local instant               | `scheduledFor` (UTC instant)            |
| `daily`    | Every N days at a local time                   | `time`, `intervalDays` (1-365), `endDate?` |
| `weekly`   | Selected weekdays every N weeks at a local time | `time`, `weekdays[]`, `intervalWeeks` (1-52), `endDate?` |

All schedules use validated IANA timezone identifiers (e.g., `America/New_York`).

### Timezone & DST

- All schedules use validated IANA timezone identifiers.
- DST semantics:
  - **Nonexistent local time** (e.g., 2:30 AM during spring-forward gap) → skip
    that occurrence.
  - **Ambiguous local time** (e.g., 1:30 AM during fall-back overlap) → use
    the earlier UTC instant.
- Timezone arithmetic uses Luxon exclusively; no manual Date manipulation.

### Occurrence Lifecycle

```
PENDING → DISPATCHED → SUCCEEDED | SKIPPED | TIMED_OUT | CANCELLED
```

State transitions:
- `PENDING`: created, not yet dispatched.
- `DISPATCHED`: WorkflowRun created and assigned to a runner.
- `SUCCEEDED`: the associated WorkflowRun completed successfully.
- `SKIPPED`: occurrence skipped due to policy denial, approval gate, or
  missed start window.
- `TIMED_OUT`: run not claimed within the start window.
- `CANCELLED`: manually cancelled before dispatch.

### Schedule Lifecycle

```
ACTIVE → PAUSED | AUTO_PAUSED | COMPLETED | ARCHIVED
```

State transitions:
- `ACTIVE`: scheduler evaluates this schedule for occurrences.
- `PAUSED`: manually paused by OWNER or ADMIN; does not dispatch.
- `AUTO_PAUSED`: automatically paused due to policy change, ambiguous outcome,
  or INTERRUPTED run. Requires OWNER or ADMIN to resume.
- `COMPLETED`: one-time schedule fired or end date passed.
- `ARCHIVED`: manually archived; does not dispatch.

### Concurrency

- **Multiple scheduler instances**: use `FOR UPDATE SKIP LOCKED` so only one
  instance processes a given schedule at a time.
- **Occurrence idempotency**: unique constraint on `[scheduleId, scheduledFor]`
  (stored as UTC instant) prevents duplicate occurrences.
- **Active run guard**: unique constraint on `[scheduleId]` for active scheduled
  runs prevents overlapping executions.

### Start Window

- Scheduled runs must start within a bounded window (default 5 minutes) after
  their `scheduledFor` time.
- The `missed_start_window` policy determines behavior when a run is not
  dispatched in time: skip the occurrence or pause the schedule.
- Unclaimed runs within the window are reconciled to `TIMED_OUT`.

### Policy Behavior

- The current active policy is evaluated at every occurrence dispatch.
- Policy change since schedule creation: occurrence is skipped and the
  schedule is auto-paused.
- Action denied by policy: occurrence is skipped and the schedule is paused.
- Approval-required action: occurrence is skipped and the schedule is paused.

### Ambiguous Outcomes

- `INTERRUPTED` runs (e.g., runner offline, lease expired): schedule is
  auto-paused.
- Side-effect-unknown termination (e.g., unexpected crash): schedule is
  auto-paused.
- Resume requires OWNER or ADMIN; manual `Run Now` is not available.

### Runner Capability

- `scheduled_execution_v1` is advertised **only** when the Runner is in
  unattended headless mode.
- Scheduled runs explicitly cannot include:
  - Approval steps
  - Manual repair
  - Locator repair

### Audit Events

The following typed audit events are emitted:

| Event                                 | When                                                |
|---------------------------------------|-----------------------------------------------------|
| `schedule.created`                    | Schedule created                                     |
| `schedule.paused`                    | Manually paused                                     |
| `schedule.resumed`                   | Manually resumed by OWNER/ADMIN                     |
| `schedule.archived`                  | Manually archived                                    |
| `schedule.auto_paused`               | Auto-paused (policy/ambiguous outcome)             |
| `schedule.occurrence.dispatched`      | Occurrence dispatched to a runner                   |
| `schedule.occurrence.skipped`         | Occurrence skipped                                  |
| `schedule.occurrence.start_window_expired` | Unclaimed after start window                  |

## API

| Method | Endpoint                                        | Description                         |
|--------|-------------------------------------------------|-------------------------------------|
| POST   | `/workflow-versions/:id/schedules`               | Create a schedule                   |
| GET    | `/workspaces/:id/workflow-schedules`            | List schedules in a workspace      |
| GET    | `/workflow-schedules/:id`                       | Get schedule detail                 |
| GET    | `/workflow-schedules/:id/occurrences`           | List occurrences for a schedule     |
| POST   | `/workflow-schedules/:id/pause`                 | Pause a schedule                   |
| POST   | `/workflow-schedules/:id/resume`                | Resume a paused schedule            |
| POST   | `/workflow-schedules/:id/archive`                | Archive a schedule                  |

## Out of Scope

The following are explicitly not included in Session 26:

- Cron expressions and RRULE
- Runtime inputs, secrets, and file references in schedules
- Approval Steps in scheduled runs
- Manual Repair and Locator Repair in scheduled runs
- Backfill, catch-up, or "Run Now" functionality
- External calendar integration
- Schedule editing (definitions are immutable once created)
