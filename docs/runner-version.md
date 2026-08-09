# Runner software version and build identity

Every production Local Runner build carries immutable metadata generated during
the clean build. The source of the product version is
`apps/local-runner/package.json`; the release build does not rewrite it from a
tag, environment variable or installed-machine configuration.

The embedded versioned identity contains:

- product `tasktwin-runner`
- canonical product SemVer
- exact 40-character source commit
- release target `windows` / `x64`
- existing run protocol version
- existing Workflow definition schema version
- aggregate local Runner-state schema version
- Local Secret Vault schema version

The local command prints that complete build identity:

```powershell
runner.cmd version
```

`.env`, `.tasktwin`, pairing credentials, Runner service configuration and
other mutable local files cannot replace the installed version. A missing,
linked, oversized or invalid embedded identity fails closed instead of falling
back to package configuration.

## SemVer and compatibility

Product SemVer identifies a release; it is not an execution-compatibility
shortcut. Job claims additionally depend on the run protocol, Workflow schema,
local-state schema, target platform/architecture and the Control Plane's
explicit supported/recommended version policy. Vault schema and protection
profile compatibility are signed release/preflight properties but are not sent
in heartbeat software identity.

The heartbeat reports only the safe subset needed by the Control Plane:
product/version, run protocol, Workflow schema, local-state schema and canonical
platform/architecture. It does not report the source commit, installation path,
build host, CI identity, vault state or release-signing information.

## Tag binding

A production tag has the exact form `runner-v<semver>`. CI requires the tag
version, Local Runner package version and embedded build version to match. It
never rewrites a version to make a tag pass. Versioned release filenames are
immutable and an existing same-version release or asset is a publication
conflict, not an overwrite target.
