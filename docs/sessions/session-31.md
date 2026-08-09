# Session 31: Signed production Runner releases

Session 31 gives each Local Runner an immutable product identity and introduces
a controlled Windows x64 packaging and release trust boundary.

## Delivered boundary

- Framework-independent `@tasktwin/runner-release` contracts separate product
  SemVer from run protocol, Workflow, local-state and vault compatibility.
- Clean allowlisted staging creates a versioned portable Windows x64 ZIP with
  the compiled Runner, exact runtime closure, pinned Node/Chromium, WinSW and
  required scripts—not repository contents or local Runner data.
- A strict canonical release manifest binds source commit, compatibility,
  signing key ID and exact artifact filename/size/SHA-256.
- Detached Ed25519 signatures resolve only through a pre-trusted,
  rotation-ready public-key registry. Production private material exists only
  in the protected release job; tests use ephemeral/integration keys. A
  separately reviewed production public key and matching protected credential
  are prerequisites for the first production publication.
- Local `version`, `release verify` and `upgrade preflight` commands run before
  service interruption. Preflight is deterministic and read-only; unsupported
  migrations and unsafe downgrades are blocked.
- Heartbeats report only safe build identity. The Control Plane derives
  `compatible`, `update_recommended`, `update_required` or `unsupported`; only
  the first two may claim jobs.
- Runner-side claimed-job protocol and Workflow-schema validation still occurs
  before Chromium.
- Incompatible scheduled occurrences create no executable run and reuse the
  transactional Schedule Auto-Paused path with `runner_update_required`.
- Runner Detail shows installed identity and compatibility without remote
  update/install controls. Actual accepted version changes create one strict
  `runner.software_version.changed` audit event.
- A tag-only CI release builds, inspects, signs, self-verifies and publishes the
  immutable ZIP, manifest and detached signature together. PR/dry-run builds
  cannot access production signing material.

Production publication intentionally remains fail-closed until operators add a
reviewed production public key to the compiled trust set and provision its
matching private credential in the protected release environment.

## Trust and compatibility

The signed ZIP proves release provenance and archive integrity. It is not
Authenticode, extracted-file attestation or proof that an authenticated device
is currently executing unmodified release bytes. Heartbeat software metadata
is authenticated self-report.

The current compatibility values preserve run protocol 2, Workflow definition
schema 1, aggregate local state schema 1 and Local Secret Vault schema 1. Vault
protection-profile declarations distinguish passphrase and Session 30 Windows
native state even though both currently use vault schema 1.

## Limits

Windows x64 is the only artifact. Session 31 does not implement MSI,
Authenticode, macOS/Linux/ARM releases, automatic download/install/update,
silent update, rollback, state migration, delta update, SBOM, provenance,
release-catalog synchronization or remote shell/service execution. A manual
upgrade verifies and preflights first, then explicitly reinstalls the Windows
service against a new versioned directory.
