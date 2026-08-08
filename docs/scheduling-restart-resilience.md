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
