# Local Runner service

## Modes and capabilities

- `interactive`: headed/attended components may be used; autonomy is
  `interactive`.
- `unattended_process`: headless scheduling works while the manually started
  process remains alive; autonomy is `process_unattended`.
- `service`: Windows SCM owns startup and shutdown. It is `boot_resilient` only
  after service verification, native vault unlock and inventory sync succeed.

`runner_service_v1`, `os_native_secret_unlock_v1`,
`scheduled_execution_v1` and `local_secret_store_v1` are independent and
derived from current runtime checks. Service mode rejects interactive secret
prompts, headed execution and attended repair.

## Local commands

```powershell
pnpm --filter @tasktwin/local-runner service:prepare-windows
pnpm --filter @tasktwin/local-runner build
pnpm --filter @tasktwin/local-runner runner -- service install
pnpm --filter @tasktwin/local-runner runner -- service status
pnpm --filter @tasktwin/local-runner runner -- service start
pnpm --filter @tasktwin/local-runner runner -- service stop
pnpm --filter @tasktwin/local-runner runner -- service restart
pnpm --filter @tasktwin/local-runner runner -- service uninstall
```

These commands are local privileged operations. They accept exactly one fixed
operation and never accept a Runner credential, passphrase or secret value.
Uninstall removes service configuration but preserves `.tasktwin` Runner data.

## Startup, reconnect and shutdown

Startup acquires the Runner-ID lock, loads pairing state, initializes native
key protection, unlocks and validates the vault, synchronizes inventory,
initializes execution components, sends a heartbeat and then polls jobs. No
ready capability is sent earlier.

The first heartbeat also reports the immutable packaged software identity.
Only product version, run protocol, Workflow schema, aggregate local-state
schema and canonical target cross the boundary. Build commit, executable and
installation paths, service identity, signing material and vault metadata stay
local. Control Plane compatibility can block new claims without preventing a
safe authenticated heartbeat.

An unavailable Control Plane does not modify the vault. Retry delays are 1, 2,
4, 8, 16, 30 and then at most 60 seconds. Recovery resynchronizes inventory and
recomputes capabilities. Revoked or permanently rejected credentials stop the
polling loop.

Stop enters draining, removes claim capabilities, waits up to 60 seconds for
the active run, then aborts through the existing safe cleanup path if needed.
Crashes leave no resumable browser or run state. On restart the old lease is
never reused; only a new server-authorized job can be claimed.

## Update maintenance and startup health

A Session 32 managed activation supplies the service with strict activation,
update-journal and startup-status paths. A nonterminal update journal makes
the service enter local update maintenance: it pauses the claim loop and sends
heartbeats with `serviceStatus: draining` and no execution capabilities. The
Control Plane claim transaction independently rejects a persisted draining
Runner.

Update drain is distinct from ordinary service shutdown. `runner update apply`
waits up to 15 minutes for an existing run—including Approval and Repair
waits—to become terminal and does not cancel it or close its BrowserContext.
On timeout the journal becomes `failed_before_switch`, maintenance clears and
the active run continues. The service is stopped only after staging reaches
`ready_to_switch`.

Every managed service start writes a strict safe startup record with a fresh
attempt ID and the selected activation ID. Health requires exact packaged
software identity, instance lock, Workflow Engine, Policy runtime, a real
headless Chromium open/close probe, Local Secret Store health and required
native unlock. During target verification claim admission must remain closed
and no work may be active. The record contains no credential, local path,
vault identifier/value or protected key metadata.

The optional heartbeat compatibility acknowledgement adds confidence. An
absent/offline Control Plane does not make local startup unhealthy; explicit
`update_required` or `unsupported` does. See the
[local update guide](runner-update.md) and
[scheduling maintenance behavior](scheduling-restart-resilience.md).
