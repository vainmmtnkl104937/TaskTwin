# Session 37 — Performance and Concurrency Hardening

## Scope

Session 37 hardens existing PostgreSQL-backed hot paths before V1 without
introducing a queue, cache, replica, or architecture rewrite. Correctness and
Workspace isolation remain more important than raw throughput.

## Current behavior

- Workspace run, schedule, Runner, release, and rollout lists use bounded
  cursor pagination with deterministic timestamp/ID ordering.
- Workflow run lists select summary fields and step counts instead of loading
  execution evidence intended for detail views.
- Expired run leases and approvals are reconciled in bounded Scheduler work,
  not as unbounded writes inside read endpoints.
- Runner claim selection and schedule occurrence processing use PostgreSQL row
  locks with `SKIP LOCKED`; existing lease and occurrence uniqueness rules are
  unchanged.
- Scheduler dispatch and Notification Worker delivery use bounded local
  concurrency.
- Notification completion/retry/dead-letter transitions require a live lease
  owned by the current worker. In-app delivery remains idempotent.
- Approval decisions, rollout lifecycle changes, rollout stage activation, and
  rollout heartbeat observations serialize the mutable record before applying
  deterministic transitions.
- Audit append holds the Workspace chain-head lock for the surrounding domain
  transaction and updates the head once per inserted event. Hash-chain and
  append-only semantics are unchanged.
- Fleet rollout convergence uses aggregate status checks and clears completed
  desired assignments in one ownership-constrained database update.

## Database indexes

The Session 37 migration adds indexes for stable Workspace run, Runner and
rollout pages, release catalog ordering, component readiness, and Workspace-
scoped Audit entity/correlation queries. Existing claim, schedule, occurrence,
outbox, approval and rollout indexes already cover their transaction filters,
so they are not duplicated.

## Performance baseline

Run `pnpm perf:baseline` with `DATABASE_URL` set. The read-only script performs
40 measurements per query with at most eight concurrent requests for Runner
claim selection, due schedules, due outbox messages, Workspace run pages, and
Workspace Audit pages. Results are local regression signals, not production
capacity guarantees.

## Preserved invariants

- One active run per Runner and non-reusable run leases.
- Unique schedule occurrences and idempotent schedule dispatch.
- Notification at-least-once processing with idempotent delivery.
- Transactional, ordered, tamper-evident Audit chains.
- Declarative fleet rollout behavior and Workspace isolation.
