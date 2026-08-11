# ADR-037: Trusted Runner Release Catalog

## Status

Accepted for Session 33.

## Decision

The Control Plane imports only the existing Session 31 strict signed release
manifest. It resolves a configured trusted public key, verifies the detached
signature over canonical manifest bytes, computes the canonical SHA-256 digest,
validates compatibility metadata, and then persists safe metadata.

The digest is the immutable release identity. An exact retry is idempotent. The
same product and version with another digest is rejected. Release rows are not
deleted or rewritten; only the bounded governance status may move from
`available` to `deprecated` or `blocked`. Neither non-available state can be a
new rollout target.

The repository stores no signing private key, signature secret, artifact bytes,
local path or client-authored replacement metadata. Catalog writes require the
deployment-level system-administrator boundary and are recorded in an
append-only system audit chain.

## Consequences

The initial production public-key registry remains intentionally empty until
deployment owners configure reviewed public keys. Catalog import is therefore
fail-closed by default. There is no GitHub polling, download, install or update
execution in this decision.
