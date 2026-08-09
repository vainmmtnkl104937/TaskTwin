# ADR-033: Controlled Windows Runner release artifacts

Status: Accepted

## Context

The Local Runner was previously a TypeScript build launched through an
externally installed Node.js process. The build produced no versioned archive,
did not clean its output directory and had no release allowlist. A repository
copy or `pnpm pack` could include source, tests, local state or ignored secrets.
The Windows service also records absolute Node and Runner entry-point paths, so
an in-place directory swap is not a safe upgrade mechanism.

Session 31 needs one production artifact for Windows x64 without introducing an
unreviewed single-binary packager, installer or remote update channel.

## Decision

TaskTwin publishes a versioned portable directory ZIP named
`tasktwin-runner-<version>-windows-x64.zip`. A release build begins with clean
compiled output and creates a new staging directory by copying only explicitly
allowed runtime files. The directory contains the compiled ESM Runner, its
production dependency closure, the pinned Node.js Windows x64 runtime,
Playwright's pinned Chromium runtime, WinSW, the Windows native bridge, launch
scripts and required notices.

The staging and archive inspectors reject unexpected files, links and reparse
points, traversal paths, case-colliding entries, development source, tests,
fixtures, source maps, `.env` files, `.tasktwin` state, Runner credentials,
Runner private keys, Local Secret Vaults, service-instance files, browser
profiles and signing private material. Recognizable test-secret sentinels and
private-key headers are an additional scan; they are not the primary security
boundary. The primary boundary is clean allowlisted construction.

The ZIP has one versioned top-level directory. Artifact size and SHA-256 are
computed over the exact ZIP bytes that are published. The release manifest and
detached signature are separate versioned files.

## Consequences

- A target machine does not need a separate Node.js, pnpm or user-scoped
  Playwright installation.
- The artifact is a portable directory, not a single executable or MSI, and is
  comparatively large because it contains Chromium.
- Source maps are excluded so build-machine paths do not enter the release.
- Manual upgrade extracts a new immutable version directory and explicitly
  reinstalls the Windows service against its new absolute paths. Local state is
  preserved separately and is never copied into an artifact.
- Windows x64 is the only Session 31 target. macOS, Linux, ARM64, MSI,
  Authenticode, automatic update, delta update and rollback delivery remain out
  of scope.
