# Windows Runner deployment

## Prerequisites

- Windows 8/Server 2012 or newer with CNG DPAPI-NG.
- The repository-supported Node.js and pnpm versions.
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
