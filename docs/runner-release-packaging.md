# Windows Runner release packaging

Session 31 produces only a Windows x64 portable ZIP:

```text
tasktwin-runner-<version>-windows-x64.zip
```

The archive has one same-named directory containing the compiled Runner,
immutable build identity, exact production dependencies, pinned Node.js x64
runtime, Playwright Chromium, WinSW, the Windows native bridge, launch scripts
and notices. It is not a single executable or installer.

Packaging sorts ZIP entry names and normalizes entry timestamps instead of
preserving developer-machine mtimes. The artifact remains versioned by its
signed build identity; reproducible byte-for-byte output also depends on the
exact pinned runtime and dependency inputs.

## Controlled staging

Release staging always starts in a new clean directory. Existing `dist`, the
repository tree and `pnpm pack` output are not release inputs. The staging
script resolves every destination beneath the staging root and copies only
approved runtime roots. It rejects links/reparse points and unexpected files.

The following never belong in staging or the ZIP:

- `.env` files or `.git` data
- `.tasktwin`, `runner-credential.json` or Runner encryption keys
- `local-secret-vault.v1.json` or any Local Secret Store state
- Windows service-instance configuration, XML or logs
- browser profiles, cookies, storage state or recorded credentials
- source, specs, fixtures, source maps or build caches
- release private keys, PEM private-key blocks or CI secret material

Archive-name and content scans cover known fixture sentinels including the
Session 31 markers `LOCAL_SECRET_STORE_LEAK_31`,
`RUNNER_CREDENTIAL_LEAK_31`, and `RELEASE_PRIVATE_KEY_LEAK_31`, plus earlier
recognizable secret fixtures and private-key headers. Those scans supplement
the allowlist; a successful text search alone is not claimed as a security
guarantee.

## Runtime requirements

The release includes Node.js and Chromium, so neither pnpm nor a user-specific
browser cache is required on the target. Windows service support still relies
on the supported Windows x64 operating system, WinSW and the existing
LocalService/ACL/DPAPI-NG guarantees.

The launcher sets the package-local browser location before Playwright loads.
Service installation records the packaged Node executable and compiled entry
point. Because those paths are absolute, moving to a different versioned
directory requires explicit service reinstall.

## Output integrity

After ZIP creation, the inspector reopens the archive, checks its one-root
layout, rejects duplicate/case-colliding or prohibited entries, and scans entry
bytes for the recognizable secret fixtures. The dry-run also executes
`runner version` from the exact inspected staging tree. The trusted release job
additionally extracts the already verified ZIP into a temporary directory and
runs its embedded version command before publication. SHA-256 and exact size
are calculated over the final ZIP bytes for the signed manifest. Clean
allowlisted staging remains the primary contents guarantee; archive scanning
and the extracted smoke test are supplementary checks.

The signed manifest authenticates the ZIP bytes, not later changes inside an
extracted directory. Operators must protect the installed version directory;
Session 31 provides neither Authenticode nor runtime file attestation.
