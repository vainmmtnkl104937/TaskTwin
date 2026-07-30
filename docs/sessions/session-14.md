# Session 14: Local Runner foundation and secure pairing

## Included

- Framework-independent `@tasktwin/runner-protocol`.
- Short-lived one-time user codes and high-entropy device codes.
- OWNER/ADMIN Workspace approval and denial.
- Idempotent opaque runner-credential delivery.
- RunnerPairingSession, RunnerDevice, and RunnerCredential persistence.
- Separate `TaskTwinRunner` authentication.
- Heartbeat, online/offline derivation, listing, and revocation.
- Local Runner `pair`, `status`, `start`, and `unpair` commands.
- Atomic development credential storage.
- Authenticated web pairing and runner-device management.

## Trust boundaries

User identity continues to use a short-lived JWT containing only `sub`.
Runner identity uses a separate opaque credential scoped to one RunnerDevice
and Workspace. Neither identity format can authenticate as the other.

The displayed user code authorizes a human decision. The undisplayed device
code proves which polling process initiated the session. Plaintext codes and
runner credentials are never persisted by the server.

Pairing statuses are PENDING, APPROVED, DENIED, CONSUMED, and EXPIRED.
Pollers receive authorization_pending, slow_down, access_denied, expired, or
paired. Repeated early polls increase a bounded persisted interval.

## Local storage and transport

The file store writes a strict record under the current user's `.tasktwin`
directory using a temporary file and same-directory atomic rename. POSIX modes
are restricted where supported. Windows mode values are not a complete ACL
guarantee.

Plain HTTP is permitted only for loopback development. Production pairing and
heartbeat require HTTPS.

## Excluded

There is no Playwright, browser launch, workflow job polling or execution,
secret resolution, arbitrary command handling, WebSocket, cloud runner,
auto-update, credential rotation, or native OS keychain integration.
