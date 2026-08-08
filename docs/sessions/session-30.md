# Session 30: Production Local Runner service

Session 30 makes the Windows Local Runner an explicitly managed background
process and adds OS-native Local Secret Store unlock.

## Delivered boundary

- `@tasktwin/runner-service-runtime` owns strict runtime-mode, autonomy,
  lifecycle, reconnect, drain and capability derivation without platform or
  framework dependencies.
- A local-only Windows CLI installs one automatic-start WinSW service per
  Runner identity under `NT AUTHORITY\LocalService`. No Control Plane endpoint
  can install, stop, restart, uninstall or invoke commands on that service.
- A `proper-lockfile` lease keyed by Runner ID prevents interactive and service
  processes from using one identity simultaneously and supports stale-owner
  recovery. Server-side run leases remain the final concurrency authority.
- DPAPI-NG protects only the random vault master key with `LOCAL=machine`.
  Vault/Workspace/Runner/revision binding is independently authenticated, and
  the Runner data directory is ACL-scoped to the installed service SID.
- Passphrase vaults require the explicit local command
  `runner secrets protector migrate --to os-native`. The candidate vault is
  reopened and verified before atomic replacement.
- Service startup verifies identity, credential, native unlock, vault binding,
  inventory synchronization and runtime components before advertising service
  or secret capabilities.
- Transient Control Plane failures use bounded reconnect backoff. Revocation
  and permanent authentication failures stop polling.
- Shutdown stops claims, drains one active run for a bounded period, then uses
  the existing cancellation and cleanup path. A crash never persists or
  resumes browser state or a WorkflowRun lease.

## Runtime semantics

`interactive`, `unattended_process` and `service` are explicit modes.
`process_unattended` remains compatible with Session 29 schedules while the
process stays alive. `boot_resilient` requires a verified Windows service,
successful native unlock, a valid vault and synchronized inventory.

The capabilities `runner_service_v1` and `os_native_secret_unlock_v1` are
derived from initialized state. `scheduled_execution_v1` and
`local_secret_store_v1` remain separate. Native unlock failure leaves the
service online for eligible non-secret workflows but withholds both secret
capabilities.

## Limits

Windows is the only service/native-protector implementation. The native key
blob is machine-scoped; the service SID ACL is therefore an essential second
boundary. Local administrators, endpoint compromise and an already-compromised
unlocked Runner remain outside the protection claim. There is no MSI, signing,
auto-update, remote service control, durable run resume, macOS/Linux adapter,
key rotation or secret backup.
