# Local Runner secret management

The Control Plane is not a secret manager. Configure aliases on the paired Local Runner with `runner secrets init` and `runner secrets set <alias>`. Both vault passphrases and values are read through a local no-echo prompt and are rejected if supplied as command-line arguments.

The encrypted vault is stored under the existing per-user TaskTwin data directory. The file contains only safe binding metadata, random IDs, revision, protected-master-key metadata, aliases, authenticated ciphertext/nonces, and timestamps. Atomic replacement and revision checks retain the last valid vault when a write fails before replacement and prevent silent concurrent overwrite.

At portable Runner startup, an operator may unlock once. After inventory
synchronization, `local_secret_store_v1` is advertised and scheduled executions
can proceed without prompts. A passphrase-protected vault is locked again after
restart. On Windows, an operator may explicitly migrate it with
`runner secrets protector migrate --to os-native`; service startup can then
auto-unlock on the same machine. Migration is never automatic and there is no
environment-variable or plaintext-file fallback.

Secret values are acquired before Chromium launch and held in an execution-local `SecretLease`. Rotation creates a new random version and fresh ciphertext nonce. A running execution continues with its snapshot; future runs pin the new inventory revision.

Removing an alias deletes the logical encrypted record but does not promise forensic erasure from storage media, filesystem journals, snapshots, or backups.

Windows native protection is DPAPI-NG machine scope plus authenticated logical
binding and a service-SID vault ACL. It prevents use on another machine but does
not defeat a local administrator or an attacker who gains both local file
access and machine-level privilege.
