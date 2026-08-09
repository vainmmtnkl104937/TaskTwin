# Runner release pipeline

Production Runner releases are immutable and tag-driven. The only production
trigger is a canonical tag of the form `runner-v<semver>`. The tag version must
equal the Local Runner package version and packaged build identity; the
workflow never rewrites a version.

No mutable `runner-latest.zip` is published as a release identity; consumers
verify the versioned filename bound by the signed manifest.

The repository intentionally begins without a production-trusted release key.
Until a reviewed production public key is compiled into the verifier and its
matching key ID/private credential are provisioned in the protected
environment, self-verification fails closed and the workflow cannot publish a
production release. Tests and dry runs inject ephemeral keys, but the current
production trusted-key registry is empty; no test key is a production signing
root.

Provisioning requires three matching pieces:

- a reviewed production public-key entry compiled into the Runner verifier
- non-secret repository variable `RUNNER_RELEASE_SIGNING_KEY_ID`, available to
  candidate generation
- protected `runner-production-release` environment secret
  `RUNNER_RELEASE_SIGNING_KEY_PKCS8_BASE64`, containing the matching Ed25519
  PKCS8 DER encoded as base64

The key ID is routing metadata, not a credential. The private-key secret is
referenced only by the signing step.

## Candidate job

The Windows x64 candidate job has no production signing credential. It checks
out the exact tagged commit, requires it to be reachable from `main`, installs
the frozen lockfile, runs lint, typecheck, unit tests and build, creates clean
allowlisted staging, packages
the ZIP, inspects the staging tree and archive, computes exact size/SHA-256 and
generates the canonical unsigned manifest. Only the candidate ZIP and manifest
cross to the trusted job.

Any command failure prevents the signing job from starting.

## Trusted signing and publication

The signing job uses a protected GitHub Environment and least-privilege
`contents: write`. It downloads the candidate, repeats the safety and integrity
checks, resolves the approved key ID, exposes the PKCS8 Ed25519 private key only
to the signing step, signs canonical manifest bytes and immediately verifies
the public signature and exact artifact descriptor.

External GitHub Actions are pinned by commit. The trusted job checks out the
same tag, rebuilds the public verifier without exposing the private key,
extracts the verified ZIP into a temporary directory, and runs its embedded
`runner version` before publication.

Publication refuses an existing release or same-version asset. It creates a
draft, uploads exactly the Windows x64 ZIP, versioned manifest and detached
signature, and publishes only after self-verification. A partial or conflicting
release requires operator intervention; files are never silently overwritten.

Repository tag protection, environment reviewers and review of the tagged
workflow commit are operational requirements. The private key is never logged,
uploaded, copied into the repository workspace or made available to PR/fork,
ordinary test or Web jobs.
The signing command reads the base64 PKCS8 credential from its step-only
environment, validates Ed25519, zeroes the decoded byte buffer, and removes the
process environment value in `finally`. This is best-effort process-memory
cleanup, not a hardware-backed signing guarantee.

## Dry run

The local and PR dry-run path builds, stages, inspects, packages and creates the
same three-file release shape using a newly generated ephemeral Ed25519 test
key. It refuses to run if the production signing credential is present, never
references the protected environment, and never publishes. The ephemeral key
is supplied directly to the pure verifier for that process; it is not added to
the Runner's compiled trusted-key registry and cannot make a production-trusted
release.

On Windows x64 with the exact `.node-version` runtime, the local procedure is:

```powershell
$runnerBrowserRoot = Join-Path $env:TEMP 'tasktwin-runner-browsers-31'
$runnerReleaseOutput = Join-Path $env:TEMP ("tasktwin-runner-dry-run-" + [guid]::NewGuid())
$env:PLAYWRIGHT_BROWSERS_PATH = $runnerBrowserRoot
pnpm --filter @tasktwin/local-runner exec playwright install chromium
pnpm --filter @tasktwin/local-runner service:prepare-windows
pnpm build
pnpm --filter @tasktwin/local-runner release:dry-run -- `
  --output-dir $runnerReleaseOutput `
  --browser-source $runnerBrowserRoot
```

The output directory must not already exist. The command self-verifies its
ephemeral signature internally and emits exactly the ZIP, manifest and detached
signature. That ephemeral signature is deliberately not accepted by the normal
compiled production verifier.
