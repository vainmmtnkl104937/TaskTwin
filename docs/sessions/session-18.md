# Session 18: Secure runtime inputs

Session 18 delivers runtime variables end to end without exposing plaintext to
the Control Plane and establishes local-only secret resolution.

## Included

- Framework-independent `@tasktwin/secure-run-inputs` Zod contracts
- Fixed AES-256-GCM plus RSA-OAEP SHA-256 profile and deterministic AAD
- Runner-owned local private key and authenticated public-key registration
- Explicit secure-envelope and interactive-secret capabilities
- New preparation, encryption-key and immutable envelope persistence
- Published-version run preparation and transactional encrypted commit
- Browser Web Crypto variable encryption with no browser persistence
- Assigned-Runner decryption and validation before Chromium startup
- No-echo, cancellable, bounded local secret prompts and disposable leases
- Existing claim, lease, progress, cancellation and completion lifecycle

## Excluded

File delivery, plaintext server inputs, server secret forms, persistent secret
storage, automatic key rotation, OS keychains, saved authentication profiles,
retry/resume and AI remain out of scope.

## Security boundaries

The Control Plane stores public keys, safe manifests and ciphertext only.
Envelope AAD binds all dispatch identities and policy metadata. Values remain
in Web component memory before encryption and Runner memory after decryption;
they never belong in storage, logs, progress or completion JSON. Cleanup clears
mutable buffers and disposes secret leases, while immediate JavaScript string
zeroization cannot be guaranteed.

## Verification

Default unit tests cover strict contracts, manifests, AAD binding, secret-lease
disposal, RSA/AES decryption, wrong-key rejection and ciphertext tampering.
Database/API and real-browser verification remain explicit because they require
PostgreSQL, an authenticated Web session, an attended Runner and Chromium.
