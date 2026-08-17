# TaskTwin Release Versioning

This repository carries three independent identifiers. Operators and reviewers
must not confuse them.

## Product release tag

The TaskTwin product release is identified by the tag `v<MAJOR>.<MINOR>.<PATCH>`
optionally suffixed with `-rc.<N>` for release candidates. The current tag is
recorded in the top-level `VERSION` file.

- `VERSION` is the single, machine-readable source of truth.
- Git tags `v1.0.0-rc.1`, `v1.0.0`, … are cut from the branch that carries that
  file. Tagging never rewrites `VERSION`.
- The product release tag appears in release notes, on the landing page, and in
  the RC smoke runbook. It is **not** the workspace or Runner version.

## Workspace package versions

Each `package.json` under `apps/` and `packages/` keeps its inner SemVer. All
private workspaces currently report `0.1.0` because the product is pre-1.0 and
nothing has been published externally. Bumping them is a packaging decision that
follows the product release tag, not the other way around.

## Local Runner version

The Local Runner SemVer is the single source of truth for Runner software
identity. It is generated during the clean build from
`apps/local-runner/package.json` and embedded in `build-identity.json`; `.env`,
service configuration, and pairing state cannot override it. Heartbeats expose
the safe subset (Runner SemVer plus protocol, workflow, local-state and
platform schemas) — never the source commit, install path, CI identity or
signing material.

Production Runner tags follow `runner-v<semver>` and must match the embedded
Runner version exactly. CI never rewrites a version to make a tag pass.

## How they relate

| Concept | Where it lives | Editable during tag? |
| --- | --- | --- |
| Product release tag | `VERSION` and git tag | No — tagging only |
| Workspace package version | `apps/*/package.json`, `packages/*/package.json` | Yes, on package changes |
| Runner SemVer | `apps/local-runner/package.json` → `build-identity.json` | Yes, per Runner release |

`v1.0.0-rc.1` is the first release-candidate tag for the browser-first MVP.
Subsequent tags follow the same model. Tagging never mutates any of the three
identifiers above to make a build pass.