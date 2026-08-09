# Windows Runner deployment

## Prerequisites

- Windows 8/Server 2012 or newer with CNG DPAPI-NG.
- For a source deployment, the repository-supported Node.js and pnpm versions.
  A packaged Session 31 archive carries its pinned Node and Chromium runtimes
  and does not require host pnpm or a user-scoped Playwright cache.
- A paired Local Runner and an initialized Local Secret Store when secret
  schedules are required.
- Administrator rights for service installation and ACL changes.

## Deployment sequence

1. Pair and verify the interactive Runner.
2. Initialize the vault and configure aliases locally.
3. Run `runner secrets protector migrate --to os-native`; enter the existing
   passphrase only at the no-echo prompt.
4. Confirm `runner secrets protector status` reports Windows native protection.
5. Prepare the pinned WinSW 2.12.0 artifact. The helper permits only fixed
   GitHub release hosts and verifies SHA-256
   `b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f`.
6. Build the Runner, install the service, then start it.
7. Confirm Runner Detail reports Service mode, OS-native unlock and boot
   resilience before relying on reboot execution.

For a packaged release, first run `runner release verify` and
`runner upgrade preflight` against the versioned ZIP, manifest and detached
signature while the old service remains active. Session 32 can then apply the
same already-downloaded files only when the current installation already has a
verified managed base:

```powershell
runner.cmd update apply --manifest <path> --signature <path> --artifact <path> [--data-root <runner-data-root>]
```

The production trusted-key registry is currently empty, so a reviewed compiled
production public key and matching protected CI signer are prerequisites.
Pre-Session-32/manual Session 31 installations—including a service installed
by the source-oriented sequence above—lack a managed active-release record,
retained signed proof and per-release activation. The controller refuses them
with `update_current_release_unverified`; Session 32 provides no automatic
adoption command. Establish the initial managed installation only through a
separately reviewed out-of-band bootstrap procedure.

The managed controller stores immutable versioned software and retained proof
under `%ProgramData%\TaskTwin\RunnerInstallations\<runner-device-id>` and keeps
the selected `.tasktwin` data root separate. It prepares an adjacent WinSW
executable/XML pair per release and explicitly rebinds SCM after staging; it
does not overwrite running bytes or require a symlink. See the
[managed layout](windows-runner-update-layout.md).

When the service uses a non-default data root, pass the same absolute
`--data-root` to update, rollback and recovery so preserved credential, vault
and native protector binding remain on that root.

The service uses `LocalService` plus a unique service SID and grants that SID
modify access only to the selected `.tasktwin` data directory. The executable,
entry point, data directory and Runner identity are fixed in a strict local
configuration. There are no credentials in SCM arguments.

## Verification and rollback

Test install/start/stop/reboot in a dedicated Windows environment. A production
reboot check must confirm automatic start, native unlock, inventory sync and a
new scheduled run without a passphrase. Forced termination must leave the old
run to normal Control Plane lease-expiry/Interrupted handling.

For a managed installation, `runner.cmd update rollback` may select only the
retained verified previous release and requires an idle Runner. The controller
revalidates signed proof, current compatibility and restored startup health.
A failed target apply attempts the same rollback automatically only while those
proofs remain safe. It never downgrades local state or the vault.

`runner.cmd update recover` reconciles an interrupted journal with SCM,
active-release and health evidence. Ambiguous selection or unsafe rollback
enters `manual_recovery_required`; there is no force path. Preserve the
installation evidence and use a reviewed out-of-band recovery procedure. See
the [rollback guide](runner-update-rollback.md) and
[recovery guide](runner-update-recovery.md).

Native-to-passphrase downgrade is not available. Restore from the last
independently protected operational backup only under the organization's
recovery policy; TaskTwin provides no vault backup feature. TaskTwin also does
not discover or download releases, expose remote update/rollback, or migrate
local/vault schemas.

The full privileged version-A to version-B SCM rebind, native-secret scheduled
workflow and deliberately broken-target rollback scenario has not been run in
this working environment. The included unit and opt-in Windows adapter suites
do not substitute for testing it on a dedicated service host.
