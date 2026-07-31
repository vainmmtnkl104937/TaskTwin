# Session 17: persisted WorkflowRun dispatch

## Included

- Framework-independent run, claim, lease, progress and completion contracts
- Published workflow execution-readiness checks
- Server-derived allowed origins
- WorkflowRun, WorkflowRunStep and progress receipt persistence
- Idempotent run creation, claim, progress and completion
- One active job per Local Runner
- Hashed renewable run leases
- Monotonic progress projection into canonical step rows
- Cooperative cancellation and lease-expiry interruption
- Local Runner claim, renewal, progress and completion loops
- Safe Web run creation, history, detail and cancellation

## Lifecycle

Runs move through Queued, Claimed, Running and terminal states. A cancellation
request is immediate for queued work and cooperative for active work. Expired
leases produce Interrupted. Terminal states are immutable and Interrupted is
never automatically requeued.

Every source workflow step is created transactionally with the run. Progress
and completion validate IDs, types and execution order against the immutable
Published definition.

## Security boundary

User JWTs authorize creation and reads. Runner credentials authenticate a
paired device. A separate run lease authorizes only renewal, progress and
completion for one assigned run. Credentials and lease tokens never enter
PostgreSQL, safe metadata, Web pages or logs.

## Excluded

Runtime variables, files, secret delivery, automatic retry, requeue, resume,
Redis, BullMQ, WebSocket, scheduling, parallel jobs, persistent profiles,
screenshots, traces and AI remain out of scope.
