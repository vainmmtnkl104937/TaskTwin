# Scheduling restart resilience

Session 29 process-unattended Runners remain valid: a manually unlocked process
can run scheduled secret workflows until it exits. Session 30 adds a truthful
restart-resilience dimension rather than invalidating these schedules.

A Runner reports `boot_resilient` only when Windows service state is verified,
native master-key unlock succeeds, the bound vault validates and inventory is
synchronized. Scheduling still requires `scheduled_execution_v1`; a secret
workflow additionally requires `local_secret_store_v1` and the existing alias,
revision and digest checks.

Every occurrence rechecks inventory. Every scheduled run pins vault ID,
revision and digest. A rotation after run creation still blocks the stale run
before Chromium and conservatively pauses its schedule. Restart does not resume
old runs or browser state; lease expiry supplies the existing Interrupted and
ambiguous-outcome safeguards.

Session 32 update maintenance is a temporary capacity state, not a policy or
secret-readiness failure. Once the assigned Runner reports `draining` in
`serviceStatus`, the Control Plane creates a single `SKIPPED` occurrence with
reason `runner_maintenance`, creates no WorkflowRun, and emits only the strict
occurrence-skipped audit event. It does not auto-pause or alert. Recurring
schedules advance from the scheduler's current time to their next future
instant and are never backfilled; one-time schedules complete. After the
Runner returns healthy and reports normal capacity, later recurring
occurrences use the same policy, vault-inventory, compatibility, lease and
one-active-run gates as before.

Repeated draining heartbeats keep that maintenance observation fresh for long
bounded updates. If the service is temporarily stopped for activation, the
last accepted maintenance report remains valid for a bounded 20-minute
post-heartbeat window; older stale metadata falls back to ordinary offline
handling. Fresh maintenance takes precedence over a transient incompatible
target heartbeat so the scheduler does not auto-pause while the local
controller is still able to restore the source. The Runner emits another
best-effort heartbeat as soon as maintenance becomes terminal to clear the
draining state promptly.
