# Session 32: Secure local Runner update and rollback

Session 32 adds an operator-invoked Windows x64 update controller for a
previously downloaded, signed TaskTwin Runner release. It builds on the
Session 31 release trust boundary; it does not create a second signature,
digest or compatibility implementation.

## Delivered boundary

- `@tasktwin/runner-update` owns strict framework-independent update plans,
  state and record schemas, forward/rollback compatibility decisions, startup
  health decisions, crash-recovery decisions, retention and safe summaries.
- The Local Runner verifies the target manifest, detached Ed25519 signature,
  trusted key, exact artifact name, size and SHA-256 before acquiring the
  update lease or entering maintenance. It verifies the same inputs again
  while holding the lease and verifies the retained current release proof.
- Apply requires a newer product SemVer, compatible explicit protocol/schema
  axes, forward compatibility without migration, and a conservative proof
  that the retained source can read every local/vault schema the target may
  write.
- A separate `proper-lockfile` lease prevents concurrent update commands and
  provides bounded stale-owner recovery. A strict versioned journal is
  replaced atomically on every valid state-machine transition.
- Maintenance removes execution capabilities and pauses the local claim loop.
  The Control Plane transaction also rejects a claim from a Runner whose last
  accepted service status is `draining`.
- Apply waits up to 15 minutes for running, Approval-waiting, Repair-waiting or
  cancel-requested work to become terminal. A timeout fails before switch,
  clears maintenance through the terminal journal state and leaves the active
  workflow running; the update controller does not cancel it.
- The signed ZIP is copied into an update-specific staging tree, reverified,
  extracted by a fixed local Windows adapter with bounded archive limits, and
  checked against the Session 31 allowlisted runtime layout. Extracted bytes
  are compared to the ZIP before the target is committed as an installed
  release.
- The Windows service is stopped only after staging and activation preparation
  complete. SCM is rebound to an adjacent per-release WinSW executable/XML
  pair, and an atomic active-release record makes the release selection
  explicit.
- The controlled installation tree is protected by an exact Windows DACL:
  SYSTEM and Administrators retain full control, while the unique service SID
  receives read/execute on immutable release bytes and Modify only on runtime
  status/log state. ACLs and critical runtime hashes are revalidated before
  SCM rebind/start, and system tools use absolute System32 paths.
- Target verification requires the selected service executable, exact embedded
  software identity, a fresh startup attempt, instance lock, Workflow Engine,
  Policy runtime, Chromium, Local Secret Store and—when previously required—
  native secret auto-unlock. SCM `RUNNING` alone is insufficient.
- A locally healthy target is accepted when the Control Plane is absent or
  temporarily unavailable. A missing optional acknowledgement does not
  overturn local health; an explicit reachable acknowledgement of
  `update_required` or `unsupported` is unhealthy for the new target only.
- Failed target health triggers automatic rollback only after the previous
  signed release is reverified and rollback compatibility is reevaluated
  against current persisted state. The restored release must also pass local
  health.
- `runner update status`, `apply`, `rollback` and `recover` are local commands.
  Rollback can select only the retained previous release; recovery never
  reconstructs or resumes a WorkflowRun or reuses its lease.
- Scheduled occurrences observed while the assigned Runner is draining are
  skipped once with `runner_maintenance`. Recurring schedules advance to their
  next future occurrence without backfill or unnecessary auto-pause.

## State and trust model

The normal apply path is:

```text
idle -> preparing -> draining -> staging -> ready_to_switch -> switching
     -> starting_target -> verifying_target -> succeeded
```

Pre-switch failures terminate as `failed_before_switch`. Post-switch target
failure may enter `rolling_back -> rolled_back`; missing proof, unsafe rollback
or ambiguous SCM/active-record observations enter the absorbing
`manual_recovery_required` state.

Installed-release metadata is not accepted as cryptographic proof by itself.
Each managed release retains its signed manifest, detached signature and exact
ZIP, and the controller revalidates those files plus the extracted tree when it
loads a current, target or rollback release.

## Security and data boundaries

The controlled software root is separate from mutable `.tasktwin` data. The
controller does not copy, decrypt, re-encrypt or migrate the Local Secret
Vault; rotate its protector; copy Runner credentials; export protected-key
metadata; execute scripts from the archive; or persist workflow/run/lease
state in its journal. It inspects only strict local schema/protection metadata
needed for compatibility and health.

There are no integrity or compatibility bypass flags. The Control Plane and
Web expose no update, rollback, installer, PowerShell or shell execution
endpoint. Central audit continues to observe only an authenticated
`runner.software_version.changed` heartbeat transition, never local paths,
proof files or journal contents.

## Current operational limitations

- Windows x64 is the only supported update target.
- The controller consumes three already-downloaded local files. It does not
  discover, poll, download or silently install releases, and there is no remote
  or fleet rollout.
- The production trusted public-key registry is intentionally empty. A reviewed
  compiled production public key and matching protected CI signing credential
  remain prerequisites for a production apply.
- Pre-Session-32/manual Session 31 installations have no verified managed
  active-release record or retained rollback proof. They fail with
  `update_current_release_unverified`; this session provides no automatic
  adoption command. An operator must perform a separately reviewed,
  out-of-band managed-installation bootstrap before the controller can update
  such an installation.
- The SCM installation/rebind and full version-A to version-B service scenario
  were not executed against a real installed Windows service in this working
  environment. The real SID-based ACL adapter also was not applied because the
  current process is not elevated. Unit tests and opt-in Windows adapter tests
  do not replace a privileged dedicated-host validation.
- Automatic rollback covers failed target startup/mandatory health only when
  the retained source and current state still prove safe. It is not a general
  rollback guarantee, state backup, disaster-recovery system or automatic
  rollback after later workflow failures.
- `manual_recovery_required` deliberately has no automatic or force exit.
  Recovery then requires an operator to inspect SCM binding, active release,
  retained proof and mutable-state compatibility out of band.
- The Session 32 controller supports updates only when both signed releases use
  the currently implemented Runner protocol. A protocol-N Runner cannot use
  this controller to cross directly to protocol N+1; that transition requires
  a separately reviewed manual/bootstrap procedure until an explicit updater
  protocol-range contract exists.

See [ADR-035](../adr/ADR-035-secure-runner-update-controller.md),
[ADR-036](../adr/ADR-036-runner-update-rollback-safety.md), the
[operator guide](../runner-update.md), [installation layout](../windows-runner-update-layout.md),
[rollback guide](../runner-update-rollback.md) and
[recovery guide](../runner-update-recovery.md).
