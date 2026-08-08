# Session 29: Local Secret Store

Session 29 adds unattended scheduled-secret resolution without moving secret plaintext into the Control Plane.

## Delivered boundary

- `packages/local-secret-store` owns strict versioned vault, inventory, AAD, pin, status, digest, safe-summary, protector-interface, and error contracts without framework, database, filesystem, or platform-crypto dependencies.
- The Local Runner supplies AES-256-GCM, scrypt key protection, no-echo prompts, atomic file persistence, CLI mutation, startup unlock, inventory synchronization, and `LocalVaultSecretProvider`.
- PostgreSQL stores safe per-Runner inventory metadata and monotonic trust state only.
- Scheduled readiness requires `scheduled_execution_v1` and, for secret workflows, `local_secret_store_v1`, READY synchronized inventory, and every required alias.
- Occurrences re-check readiness. Missing/locked/corrupt/incomplete stores skip the occurrence and auto-pause through the existing schedule alert path.
- Scheduled runs pin safe inventory metadata; stale pins fail before the Runner receives workflow execution work.

## Operator commands

```text
runner secrets init
runner secrets status
runner secrets set <alias>
runner secrets remove <alias>
runner secrets list
```

Passphrases and values are prompted locally without echo. There is deliberately no reveal, show, dump, or export command, and values are never accepted on argv.

## Limitations

Only bounded UTF-8 text secrets are supported. Unlock is process-local and must be repeated after restart. Automatic OS-level unlock, forensic erasure guarantees, secret history, cloud backup, binary material, OTP generation, cloud providers, and cross-Runner sharing are not implemented.
