# @tasktwin/local-secret-store

Framework-independent contracts for TaskTwin's encrypted Local Secret Store.
The package validates safe aliases, versioned vault and inventory records,
deterministic AAD, metadata-only inventory digests, safe status summaries and
stable errors. It performs no filesystem, database, framework or platform
cryptography operations.

Secret plaintext and passphrases are never represented by persisted vault or
inventory object fields. Platform AES-GCM, scrypt, local prompting and atomic
file persistence are implemented only by the Local Runner.

The versioned protected-master-key union supports the original passphrase
profile and a Windows-native profile without importing Windows APIs here.
`LocalSecretMasterKeyProtector` returns a disposable `MasterKeyLease`; the
Windows adapter, explicit migration workflow and DPAPI-NG bridge remain in
`apps/local-runner`. Native protected blobs are local vault metadata and are
not part of inventory or Runner protocol schemas.
