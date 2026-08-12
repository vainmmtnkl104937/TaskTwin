# Session 38 — Backup, Restore and Disaster Recovery

TaskTwin V1 has a portable PostgreSQL logical-backup and clean-restore baseline
with compressed versioned archives, SHA-256 integrity metadata, deterministic
retention and offline audit-chain/restored-state verification.

The Docker drill proves backup, checksum, clean restore, migration, API
readiness, authenticated Runner reconnect, interruption of expired runs and
idempotent notification resumption. Scheduling retains skip/no-backfill
semantics. Local Runner secret stores remain outside Control Plane backups.

See `docs/disaster-recovery.md` for procedures, RPO/RTO and limitations.
