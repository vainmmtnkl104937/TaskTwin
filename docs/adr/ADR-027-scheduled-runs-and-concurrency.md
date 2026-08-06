# ADR-027: Scheduled WorkflowRuns and Concurrency

## Status

Accepted.

## Context

TaskTwin workflows carry real-world consequences. Scheduling them requires
explicit, auditable structure rather than arbitrary cron expressions. The system
must also handle safe multi-instance concurrency, DST transitions, policy changes,
and ambiguous execution outcomes without introducing Redis, in-memory mutexes, or
hidden scheduling logic.

## Decision

### Structured Schedules Instead of Cron

TaskTwin uses three explicit schedule types instead of cron or RRULE:

- **one_time**: a single future firing at a specific UTC instant.
- **daily**: fires every N days (1-365) at a local time in a validated IANA
  timezone, with an optional end date.
- **weekly**: fires on selected weekdays every N weeks (1-52) at a local time
  in a validated IANA timezone, with an optional end date.

Definitions are immutable once created. Schedule editing is out of scope;
pausing, resuming, and archiving are the available lifecycle controls.

### DST Semantics

All schedules use validated IANA timezone identifiers. DST transitions are handled
by Luxon:

- **Nonexistent local time** (e.g., 2:30 AM during spring-forward gap): skip
  that occurrence entirely.
- **Ambiguous local time** (e.g., 1:30 AM during fall-back overlap): use the
  earlier UTC instant.

No timezone arithmetic is performed manually.

### Immutable Schedule Definitions

A schedule is created with a pinned WorkflowVersion. The schedule always dispatches
against that version, not against any subsequently published version. This preserves
auditability and prevents unexpected behavior from version changes.

### Scheduled Execution Capability

`scheduled_execution_v1` is advertised **only** when a Runner is in unattended
headless mode. Scheduled runs explicitly exclude:

- Approval steps
- Manual repair
- Locator repair

These restrictions prevent attended-only operations from blocking automated
scheduled execution.

### Multi-Instance Scheduler Concurrency

The scheduler polls every 30 seconds for due ACTIVE schedules. Multiple
scheduler instances use `FOR UPDATE SKIP LOCKED` to prevent two instances from
processing the same schedule simultaneously. No Redis or in-memory mutex is
used.

Occurrence idempotency is enforced by a unique constraint on
`[scheduleId, scheduledFor]` (stored as a UTC instant). At-most-once dispatch
is guaranteed even across scheduler restarts.

### Missed Start Window Policy

Scheduled runs must start within a bounded window (default 5 minutes) after
their `scheduledFor` time. A `missed_start_window` policy setting controls
behavior: skip the occurrence or auto-pause the schedule.

Unclaimed runs within the window are reconciled to `TIMED_OUT` by a background
process.

### Policy Re-Evaluation at Every Occurrence

The current active policy is evaluated at every occurrence dispatch, not only at
schedule creation time. If the policy has changed, the occurrence is skipped
and the schedule is auto-paused. If an action is denied or requires approval,
the occurrence is skipped and the schedule is paused.

### Ambiguous Outcome Auto-Pause

When a scheduled run terminates with an `INTERRUPTED` status or a
side-effect-unknown outcome, the schedule is auto-paused immediately. OWNER or
ADMIN must review and manually resume. No automatic retry or `Run Now` is
available for scheduled runs.

## Consequences

- **Positive**:
  - Schedules are explicit and auditable without arbitrary expression parsing.
  - DST is handled correctly by a proven library without manual logic.
  - Multi-instance scheduling is safe with no external coordination service.
  - Policy enforcement at every occurrence prevents stale policy from
    authorizing a scheduled run.
  - Ambiguous outcome auto-pause prevents silent repeated failures.

- **Negative**:
  - Schedule editing requires archive + create; no in-place modification.
  - Runners cannot service scheduled runs unless they are in unattended headless
    mode.
  - One-time schedules that miss their window cannot be re-dispatched without
    creating a new schedule.
  - The bounded start window may cause rare skipped runs if all runners are
    busy.

## Alternatives Considered

### Cron Expressions

Rejected because they allow arbitrary complexity that cannot be audited
safely. Structured schedules with limited types force intentionality.

### BullMQ or Redis-Backed Job Queue

Rejected because the existing PostgreSQL database already provides all needed
concurrency primitives (`FOR UPDATE SKIP LOCKED`, unique constraints,
serializable transactions). Adding a separate queue would introduce a new
failure domain, operational complexity, and consistency challenges between the
queue and the control plane.

### Immediate Retry on Interrupted Runs

Rejected because interrupted runs have unknown side effects. Automatically
retrying without human review could produce duplicate real-world actions
(e.g., double form submissions). Auto-pause forces explicit human review.

### Runtime Inputs in Schedules

Deferred to a future session. Runtime inputs require additional security
analysis for scheduled contexts, particularly around secret handling and
input validation.
