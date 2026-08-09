# ADR-034: Canonical signed Runner release manifests

Status: Accepted

## Context

A checksum delivered beside an artifact is not a trust root: an attacker who
can replace both files can publish a matching malicious checksum. TaskTwin also
needs to express protocol and persisted-state compatibility independently from
product SemVer and to reject an artifact before stopping the installed Runner.

Existing per-Runner RSA keys protect secure runtime-input delivery. They are
device encryption keys and must not become release-signing identities.

## Decision

Each release has a strict version 1 manifest containing only build-derived
product identity, stable channel, source commit, normalized build timestamp,
explicit compatibility declarations, exact artifact descriptors and an
approved signing key ID. Artifact descriptors bind target, filename, archive
format, exact byte size and SHA-256.

After strict schema validation, TaskTwin serializes the manifest with the
existing canonical JSON implementation. SHA-256 and an Ed25519 detached
signature cover the exact canonical UTF-8 bytes. The detached signature records
its schema version, algorithm, key ID, manifest digest and base64url signature.

The manifest cannot introduce a public key. A verifier resolves `keyId` only
from a small pre-trusted SPKI public-key registry compiled into the release
verification boundary. Unknown keys, mismatched key IDs, digest failure,
signature failure, absent target artifacts, filename differences, exact-size
differences and artifact-hash differences all fail closed. There is no
ignore-integrity or arbitrary-key option.

The Ed25519 PKCS8 private key exists only in the protected CI signing
environment. It is separate from Runner pairing credentials and per-device RSA
encryption keys. Tests generate ephemeral keys. Production private material is
never committed, uploaded as a workflow artifact, placed in the manifest or
packaged with the Runner.

The initial production registry is intentionally empty and fails closed. Tests
and dry runs inject ephemeral keys without adding them to production trust.
Before the first production publication, a separately reviewed change must add
the production public key and the protected release environment must receive
its matching private credential.

## Key rotation

Rotation uses an overlap release: an old-key-signed Runner first trusts both
the old and new public keys, then CI changes to the new key. The old public key
is removed only after releases that require it leave the supported horizon.
The manifest itself never extends trust.

## Consequences

- Equivalent validated manifests have one object-key-order-independent digest.
- Product SemVer is release identity, not the sole compatibility decision.
- Public verification works locally before service interruption and does not
  contact GitHub or the Control Plane.
- Signing authenticates the published ZIP, not files after extraction and not
  a currently running process. Session 31 does not provide Authenticode,
  runtime attestation, SBOM or SLSA provenance.
