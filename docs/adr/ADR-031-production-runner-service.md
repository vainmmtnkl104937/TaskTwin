# ADR-031: Windows production Runner service

Status: Accepted

## Context

An unattended process can execute schedules only while an operator keeps it
running. Production scheduled execution needs boot startup, one local process
per Runner identity, bounded reconnect, truthful capability reporting and safe
shutdown without weakening Control Plane run leases.

## Decision

TaskTwin uses an OS-managed Windows service implemented by a small,
checksum-pinned WinSW wrapper. Installation is an explicit privileged local
CLI action. The generated configuration fixes the Node executable, compiled
Runner entry point, Runner ID and local data root; commands use structured
process arguments rather than an interpolated shell. The service runs as
`LocalService`, has automatic startup, and receives access only to the Runner's
`.tasktwin` directory through its per-service SID.

The local process acquires a filesystem-backed lease keyed by Runner ID before
startup. It initializes local secret state, pairing keys and inventory before
its first ready heartbeat. Connection failures are classified: transient
failures use deterministic exponential backoff capped at 60 seconds, while
revocation or permanent authentication failures stop the polling loop.

On shutdown, the Runner enters draining, reports no claim capabilities, stops
new claims and allows the active run up to 60 seconds. Timeout invokes the
existing AbortSignal path and waits for browser and sensitive-lease cleanup.
The process then disposes the master-key lease and releases its instance lock.

No run or browser state is durably resumed. A new process creates new claim
attempts and cannot reuse the old lease; the Control Plane's existing lease
expiry and Interrupted semantics resolve uncertain old work.

## Consequences

- Existing `unattended_process` scheduling stays valid and is not falsely
  described as reboot resilient.
- WinSW is prepared explicitly from a pinned version and SHA-256, not fetched
  during service installation.
- Local service operations are outside the Control Plane audit boundary.
  Central audit records only accepted safe runtime-state transitions.
- Windows service installation requires administrative rights and a dedicated
  machine integration test; default tests do not mutate Windows SCM state.
- MSI packaging, signing, updates, remote control and non-Windows services are
  not implemented.
