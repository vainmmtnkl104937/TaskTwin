# Runner secret inventory API

`POST /runner/secret-inventory` requires Runner credential authentication. The strict request is either a READY inventory (`schemaVersion`, profile, vault ID, revision, metadata digest, alias/random-version entries) or a LOCKED/UNAVAILABLE/CORRUPTED status report.

The server scopes the Runner to its assigned Workspace, locks its trusted inventory row transactionally, uses database time, and applies these rules:

- same vault, revision, and digest: idempotent;
- same revision with another digest: conflict;
- lower revision: rollback detected;
- another vault identity: conflict requiring administrative recovery outside Session 29.

An accepted new revision creates one `runner.secret_inventory.updated` audit event containing only Runner ID, previous/new revision, configured count, and metadata digest. Exact retries and status refreshes are not audited.

The schema rejects values, plaintext hashes, ciphertext, nonces, master keys, passphrases, file paths, and arbitrary properties.
