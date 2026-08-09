# Local Runner update commands

Session 32 provides a local, operator-invoked update controller for an already
downloaded signed Windows x64 release. It does not discover or download a
release and cannot be invoked through the Control Plane or Web.

## Prerequisites

- Run on Windows x64 with local administrative rights for SCM operations.
- Pair the Runner and select the same `--data-root` used by its service.
- Provide the versioned ZIP, `release-manifest.json` and
  `release-signature.json` as separate regular local files.
- The compiled trusted-key registry must contain the manifest `keyId`.
- The current installation must already be a managed verified installation
  with an active-release record and retained signed proof.

The committed production trusted-key registry is currently empty, so a
production release cannot be applied until a reviewed public key is compiled
into the Runner and its matching private key is provisioned only to trusted
release CI. Test keys are injected only by tests and are not production trust.

Pre-Session-32 and manual Session 31 installations do not meet the managed-base
requirement. `apply` fails with `update_current_release_unverified`; there is no
automatic import/adoption command. Bootstrap those installations through a
separately reviewed out-of-band procedure that verifies and places the current
release and SCM activation into the managed layout.

## Commands

With a packaged Runner:

```powershell
runner.cmd update status [--data-root <absolute-path>]
runner.cmd update apply --manifest <path> --signature <path> --artifact <path> [--data-root <absolute-path>]
runner.cmd update rollback [--data-root <absolute-path>]
runner.cmd update recover [--data-root <absolute-path>]
```

From a source checkout, the equivalent command prefix is:

```powershell
pnpm --filter @tasktwin/local-runner runner -- update status
```

`status` returns the strict active-release record and a safe journal summary.
The summary contains update ID, operation, state, versions, safe timestamps and
an optional stable failure code. It contains no local path, credential, vault
identifier/value, signing material, WorkflowRun identity or lease.

`apply` performs this fixed sequence:

1. Verify manifest/signature/key and exact artifact name, size and SHA-256
   before the update lease or maintenance.
2. Acquire the exclusive local update lease and repeat verification.
3. Reverify the current managed release and run forward, projected rollback
   and explicit protocol/schema compatibility checks.
4. Enter maintenance and wait for active work to drain (15-minute default).
5. Stage and validate the target outside the active release.
6. Stop, switch and start the selected service activation.
7. Verify local target health (three-minute default), then succeed or attempt a
   compatibility-checked rollback.

`rollback` targets only the verified `previousReleaseId`. It requires an idle
Runner (the local admission check uses a one-second bounded observation),
rechecks current compatibility, switches locally and verifies target health.
It accepts no release path.

`recover` acquires the same exclusive lease and evaluates the existing journal,
active record, SCM binding, retained proof and startup health. It does not
resume any prior workflow. Terminal state is returned unchanged; ambiguous or
unsafe state becomes `manual_recovery_required`.

Product SemVer and protocol compatibility remain separate. Both current and
target signed manifests must use the Runner protocol implemented by this
controller. A release that increments the Runner protocol cannot be installed
through this Session 32 flow and needs a separately reviewed manual/bootstrap
transition; SemVer ordering alone does not authorize it.

## Fail-closed behavior

There are no `--force`, `--skip-signature`, `--ignore-hash`,
`--ignore-compatibility`, arbitrary-key, arbitrary-executable or post-install
script options. Unknown options are rejected by strict CLI parsing. A target
that is not newer, requires migration, is forward-incompatible, lacks proven
rollback safety, targets another platform/architecture or is signed by an
unknown key does not enter maintenance.

An apply drain timeout marks `failed_before_switch`, leaves the current release
selected and does not cancel the active WorkflowRun or close its Approval or
Repair browser context. If target health fails after switch, rollback occurs
only when the retained source and current persisted schemas remain verified and
compatible. Otherwise the operation stops at `manual_recovery_required`.

## Scheduling and secrets during maintenance

Maintenance is temporary Runner capacity loss, not a policy or secret-readiness
override. Local and Control Plane claim gates remain closed. A due occurrence
for the draining Runner is recorded once as `SKIPPED` with
`runner_maintenance`; it creates no WorkflowRun, is not backfilled and does not
unnecessarily auto-pause a recurring schedule. Later occurrences still pass
the existing Runner compatibility, policy, one-active-run and Local Secret
Store inventory/pin checks. See
[scheduling restart resilience](scheduling-restart-resilience.md).

Update never reads secret plaintext, copies or rewrites the vault, exports
protected master-key metadata, rotates a protector or migrates a vault schema.
When the current vault uses the Session 30 native protection profile, target
and restored-source health require native auto-unlock and bound vault integrity
to remain usable.

See [the Windows layout](windows-runner-update-layout.md),
[rollback](runner-update-rollback.md) and [recovery](runner-update-recovery.md).
