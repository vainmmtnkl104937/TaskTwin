# ADR-035: Secure local Runner update controller

Status: Accepted

## Context

Session 31 can produce and independently verify an immutable signed Windows
x64 Runner ZIP, but its manual upgrade procedure has no transaction boundary
across release verification, active work, archive extraction and Windows
service selection. The service uses absolute paths, so replacing files in
place or relying on a mutable version setting cannot preserve a known rollback
base.

The update operation is security-sensitive because it changes the executable
that owns local browser automation and native Local Secret Store access. A
remote command channel or an integrity bypass would turn the Control Plane
into a software-execution boundary that TaskTwin does not otherwise have.

## Decision

TaskTwin implements an explicitly invoked local controller for an already
downloaded Windows x64 release. It reuses Session 31's strict manifest parser,
trusted-key lookup, canonical digest, detached-signature verification, exact
artifact-size/hash verification and upgrade-preflight contracts.

The controller follows verify-before-mutate:

1. Verify target proof and exact ZIP before creating installation state or
   entering maintenance.
2. Acquire a filesystem-backed exclusive update lease and reverify the inputs.
3. Reverify the managed current release and evaluate forward, rollback and
   controller protocol/schema compatibility.
4. Persist `preparing`, enter `draining`, stop new claims and wait for active
   work without cancelling it.
5. Copy proof files into an update-specific staging root, reverify them,
   safely extract and validate the complete release tree.
6. Commit the target as a versioned installed release and prepare an adjacent
   WinSW activation host.
7. Persist `ready_to_switch`, stop the service, rebind SCM to the target
   activation, atomically update the active-release record and start the
   target.
8. Require mandatory local startup health before marking success.

The controlled root is under
`%ProgramData%\TaskTwin\RunnerInstallations\<runner-device-id>`. Releases,
staging, journal, active pointer and safe startup status live there. Mutable
credentials, vault data, protected key metadata and Runner encryption keys
remain under the selected data root's `.tasktwin` directory and are never
copied into an installed release.

SCM points to the selected release's verified WinSW copy. The wrapper XML must
be adjacent and share its basename; it binds the packaged Node and compiled
entry point through strict activation metadata. No symlink or in-place
executable replacement is required.

Archive extraction uses a repository-owned, packaged Windows adapter, not a
script supplied by the release. It rejects traversal, absolute/drive/UNC/ADS
paths, non-canonical names, case collisions, reparse/symlink-style entries and
unsafe Windows names. Entry count, per-file bytes, total bytes and compression
ratio are bounded. The extracted tree must have exactly the signed root and
Session 31 allowlisted runtime shape, must contain no state/secret sentinels,
and must compare byte-for-byte with the signed ZIP.

Maintenance is a capacity state. The Runner continues safe heartbeat behavior
but exposes no execution capabilities, and claim admission is defended both
locally and transactionally by the Control Plane. Approval and Repair waits
remain active work. A 15-minute apply drain timeout terminates before switch
without cancelling the active run.

Target health requires more than SCM `RUNNING`: exact software identity and
activation/startup-attempt binding, selected executable, instance protection,
Workflow Engine, Policy runtime, Chromium, Local Secret Store and required
native unlock must pass while claims remain closed. Control Plane offline or
not attempted does not invalidate local health; an explicit incompatible
acknowledgement does.

## Consequences

- Update authority remains local to an operator with filesystem and SCM
  access. The API and Web gain no update, rollback, download or shell endpoint.
- Product SemVer identifies source/target releases but does not decide
  compatibility by itself.
- A strict atomic journal supplies deterministic recovery evidence, while SCM
  rebind and the active record remain two separate durable systems. Ambiguity
  between them fails to manual recovery.
- Staging temporarily retains a second ZIP, extracted runtime and activation
  host. The previous release remains intact through target verification.
- The controller has no `force`, key override, signature/hash skip,
  compatibility skip or arbitrary post-install hook.
- Existing installations without a managed active record and retained signed
  proof are rejected; Session 32 does not silently adopt them.
- Windows x64 is the only adapter. Downloading, remote rollout, schema
  migration, MSI, Authenticode and delta updates remain out of scope.
