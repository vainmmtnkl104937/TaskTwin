# ADR-030: Local Secret Store

Status: Accepted

## Context

Scheduled workflows cannot use an interactive prompt, while the Control Plane must never become a secret manager. Existing workflow definitions already refer to secrets by alias and the Local Runner already owns `LocalSecretProvider` and execution-scoped `SecretLease` abstractions.

## Decision

TaskTwin stores text-secret plaintext only in Local Runner memory. A versioned local vault persists authenticated ciphertext encrypted with AES-256-GCM. A random 256-bit vault master key is wrapped separately with AES-256-GCM under a key derived from a locally entered passphrase using the versioned scrypt parameter set `N=131072, r=8, p=1`, a 16-byte random salt, and a 256 MiB memory bound.

Every record uses a fresh 12-byte nonce. Canonical AAD binds schema/profile/algorithm, vault ID, Workspace ID, Runner ID, alias, random record ID, and random secret-version ID. Master-key wrapping AAD additionally binds the vault revision and safe inventory digest. Authentication failure is closed and reported only with a stable safe error code.

The vault lives in the existing Runner data directory, outside the repository. Writes use a bounded process-independent file lock, revision comparison, a restrictive-permission temporary file, fsync, and atomic replacement. TaskTwin does not claim forensic secure deletion.

The Runner sends only vault identity, monotonic revision, READY/LOCKED/UNAVAILABLE/CORRUPTED status, aliases, random version IDs, and a digest of that metadata. The API rejects lower revisions, conflicting equal revisions, and unexpected vault identities. Plaintext, plaintext hashes, ciphertext, nonces, passphrases, master-key material, and paths never cross this boundary.

Scheduled runs requiring secrets pin the accepted vault ID, revision, and metadata digest. Claim compares the Runner-reported pin and server inventory before returning the job. All required aliases are decrypted into one execution-local `SecretLease` before browser construction; the lease is disposed on every exit path. Vault rotation does not hot-swap an active lease.

## Consequences

- The portable MVP requires one local no-echo unlock after every Runner restart.
  ADR-032 later adds an optional, explicit Windows-native migration; portable
  passphrase behavior is unchanged.
- Scheduled secret execution is unavailable while locked or unsynchronized.
- There is no environment-variable or plaintext-file fallback.
- There is no Web entry, reveal, export, sharing, backup, master-key rotation, cloud vault, or automatic OS keychain unlock.
- A compromised unlocked Runner process or compromised operator account can access secrets in memory; disk encryption and endpoint security remain operator responsibilities.
