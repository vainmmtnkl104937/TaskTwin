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

For a packaged Session 31 release, first run `runner release verify` and
`runner upgrade preflight` against the versioned ZIP, manifest and detached
signature while the old service remains active. Require a `compatible`
decision. Extract into a new immutable version directory, then explicitly stop
and uninstall the old service and install/start from the new directory. The
service stores absolute packaged Node and Runner entry-point paths, so an
in-place path switch is not supported.
If the service uses a non-default data root, reinstall with
`runner service install --data-root <runner-data-root>` so the preserved
credential, vault and service ACL bind to the same local state.

The service uses `LocalService` plus a unique service SID and grants that SID
modify access only to the selected `.tasktwin` data directory. The executable,
entry point, data directory and Runner identity are fixed in a strict local
configuration. There are no credentials in SCM arguments.

## Verification and rollback

Test install/start/stop/reboot in a dedicated Windows environment. A production
reboot check must confirm automatic start, native unlock, inventory sync and a
new scheduled run without a passphrase. Forced termination must leave the old
run to normal Control Plane lease-expiry/Interrupted handling.

Uninstall the service locally to roll back service management; Runner data is
preserved. Native-to-passphrase downgrade is not available. Restore from the
last independently protected operational backup only under the organization's
recovery policy; TaskTwin provides no vault backup feature.

A rollback artifact must itself have a trusted signed manifest and pass
preflight against the current local-state and vault schema/protection profile.
TaskTwin does not download, install, migrate or roll back a Runner automatically.
