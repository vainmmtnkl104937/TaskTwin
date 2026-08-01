# ADR-019: Secure run-input delivery

## Status

Accepted for Session 18.

## Context

Workflow runtime variables must reach exactly one assigned Local Runner while
the Control Plane remains unable to read them. Secret values require a stricter
boundary: they must originate and remain local to the Runner.

## Decision

TaskTwin uses a fixed, versioned hybrid profile: AES-256-GCM for payloads and
RSA-OAEP SHA-256 with a 3072-bit Runner key for content-key wrapping. Each
encryption creates a new AES key and 96-bit IV using platform secure randomness.
Deterministically encoded AAD binds the envelope to its preparation, reserved
run, workflow version and digest, Workspace, Runner, key, client run ID,
origins, execution options and expiry.

The Runner generates and locally stores its private key; PostgreSQL stores
only verified public-key material and encrypted envelopes. Web encrypts before
commit. The API validates and persists but never decrypts. The Runner decrypts
and revalidates immediately before browser startup. Secret aliases are resolved
by a disposable local provider and secret values have no Web or API contract.

## Consequences

The Control Plane can coordinate and durably dispatch variable-bearing runs
without plaintext access. Compromising the database alone does not reveal
runtime values. Execution requires the assigned Runner's matching local key;
lost keys make queued encrypted runs unrecoverable.

This MVP has no file delivery, automatic key rotation, OS keychain, persistent
secret provider, retry or resume. POSIX modes are requested for local files,
but Windows confidentiality depends on the user-profile ACL. JavaScript strings
cannot be reliably zeroized immediately.
