# ADR-015: Secure Local Runner pairing and separate runner identity

## Status

Accepted for Session 14.

## Context

The Local Runner needs durable authority to identify itself to the control
plane without copying a user's short-lived JWT onto a machine service.

## Decision

TaskTwin uses a device-style pairing protocol. The runner receives a
human-readable, one-time `userCode` and a separate 256-bit `deviceCode`.
Only the user code is displayed. The server stores keyed digests of both codes,
never either plaintext value.

An authenticated OWNER or ADMIN inspects bounded device metadata and approves
the session for one Workspace. Polling then creates one RunnerDevice and one
RunnerCredential transactionally. The opaque credential is deterministically
derived from a server pepper, pairing-session ID, and high-entropy device code.
Only its keyed hash is stored.

The session becomes CONSUMED after issuance. During a two-minute delivery
window, an exact retry re-derives the same credential, preventing duplicate
devices after a lost response.

Runner requests use:

```text
Authorization: TaskTwinRunner <runnerDeviceId>.<credential>
```

This scheme has a dedicated guard and cannot be substituted by a user JWT.
Heartbeat timestamps derive online/offline state. Revocation invalidates the
device and credential together.

## Consequences

Database disclosure alone does not reveal pairing codes or usable credentials.
A stolen device code can retrieve a credential during the short delivery
window, so production transport must use HTTPS and codes must never enter logs
or URLs.

The development file store uses atomic rename and restrictive POSIX modes.
Windows mode bits are not a complete ACL guarantee. Native keychain support,
credential rotation, workflow polling, Playwright, and execution remain out of
scope.
