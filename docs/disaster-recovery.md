# Backup, Restore and Disaster Recovery

This is the portable TaskTwin V1 disaster-recovery baseline for the production
Control Plane. It covers PostgreSQL only. Local Runner installations, verified
release caches, machine identity and Local Secret Stores stay on Runner hosts
and must never be copied into Control Plane backup artifacts.

## Objectives and responsibilities

- RPO: at most 24 hours with one successful daily scheduled backup. A quiesced
  pre-deployment backup reduces deployment-change RPO to the backup start.
- RTO: four hours for the single-host baseline, including provisioning,
  integrity checks, migration, recovery reconciliation and smoke checks.
- Restore-drill target: complete the automated local drill within one hour.

Operators must schedule backups externally, monitor completion and copy every
complete artifact set off-host. Use encrypted, access-controlled storage with
immutability/versioning where available. SHA-256 detects corruption; it is not
an authenticity signature and cannot protect artifacts from an attacker who
can replace both archive and checksum.

JWT and Runner pairing, credential and lease peppers are not in PostgreSQL.
Recover the exact original values from an independent secret manager. Replacing
the credential pepper prevents existing Runners from reconnecting; replacing
the JWT secret invalidates user sessions.

## Backup artifact

`backup.sh` creates a PostgreSQL 17 custom-format archive with gzip level 6:

`tasktwin-postgresql-v1-YYYYMMDDTHHMMSSZ-REASON.dump`

`REASON` is exactly `scheduled`, `predeploy`, `manual` or `drill`. Each dump has
a `.sha256` sidecar and bounded JSON metadata containing only format version,
UTC timestamp, reason, database name, byte size, digest and completed migration
count. The dump is written as an isolated `.partial`, validated with
`pg_restore --list`, hashed, and atomically renamed before retention runs.

No passwords, database URLs, JWT values, Runner credentials, runtime input
values or local paths are written to metadata or logs. A full PostgreSQL dump
still contains all persisted Control Plane data, including password and Runner
credential hashes, so handle it as sensitive production data.

## Backup procedure

Set `TASKTWIN_BACKUP_DIRECTORY` to a host directory outside the repository and
Docker build context. For a daily backup:

```sh
docker compose --env-file /secure/tasktwin/production.env \
  -f compose.production.yaml -f deploy/control-plane/compose.dr.yaml \
  --profile dr run --rm -e TASKTWIN_BACKUP_REASON=scheduled backup
```

Before deployment, stop new writes or place the Control Plane behind a
maintenance response, allow active requests and worker batches to finish, then
run the same command with `TASKTWIN_BACKUP_REASON=predeploy`. Resume deployment
only after `BACKUP_COMPLETE` and after copying the complete three-file set to
the protected backup destination.

PostgreSQL `pg_dump` provides a transactionally consistent logical snapshot,
but a quiesced pre-deployment backup produces the clearest recovery boundary.
Do not use a partly written artifact or manually rename `.partial` files.

## Deterministic retention

Retention runs only after a new archive passes validation. Complete sets sort
by their UTC filename and retain 14 scheduled, 5 pre-deployment, 5 manual and 3
drill backups. Stale `.dump.partial` files older than 24 hours are removed.
Unknown files, symlinks and incomplete completed sets are not followed or
silently repaired. Off-host storage should enforce equal or longer retention.

## Restore into a clean database

Never restore over production. Provision isolated `postgres-restore` and use
the separate `TASKTWIN_RESTORE_DATABASE_URL_FILE`; its URL must name
`postgres-restore` and the confirmed restore database. Keep production services
stopped or connected to their original database.

1. Select one exact `.dump` filename and place its `.sha256` and `.json`
   sidecars in `TASKTWIN_BACKUP_DIRECTORY`.
2. Start the clean target:

   ```sh
   docker compose --env-file /secure/tasktwin/production.env \
     -f compose.production.yaml -f deploy/control-plane/compose.dr.yaml \
     --profile dr up --detach --wait postgres-restore
   ```

3. Restore after explicitly setting artifact and database confirmation:

   ```sh
   TASKTWIN_RESTORE_BACKUP_REF=tasktwin-postgresql-v1-YYYYMMDDTHHMMSSZ-scheduled.dump \
   TASKTWIN_RESTORE_CONFIRM_DATABASE=tasktwin_restore \
   docker compose --env-file /secure/tasktwin/production.env \
     -f compose.production.yaml -f deploy/control-plane/compose.dr.yaml \
     --profile dr run --rm restore
   ```

The restore rejects a non-empty target, verifies filename, SHA-256, byte size,
metadata and archive structure, then uses `pg_restore --exit-on-error
--single-transaction --no-owner --no-privileges`.

4. Apply forward migrations and run offline verification:

   ```sh
   docker compose --env-file /secure/tasktwin/production.env \
     -f compose.production.yaml -f deploy/control-plane/compose.dr.yaml \
     --profile dr run --rm migrate-restore
   docker compose --env-file /secure/tasktwin/production.env \
     -f compose.production.yaml -f deploy/control-plane/compose.dr.yaml \
     --profile dr run --rm verify-restore
   ```

The verifier checks migration state, every Workspace audit chain in bounded
batches, the release-catalog system audit chain, and preservation counts for
Runners, releases, rollouts, notification outbox messages and runs.

5. Start API against the restored database and require `/health/ready`. Then
   reconnect a controlled Runner using the original credential pepper and
   confirm an authenticated heartbeat. Only then switch traffic and start
   Scheduler and Notification Worker.

## Recovery behavior

- Scheduler does not enumerate and backfill every missed occurrence. Existing
  `misfirePolicy=skip` and unique `(scheduleId, scheduledFor)` behavior remain;
  recovery advances occurrence calculation from recovery time.
- Active runs whose leases expired during outage become `INTERRUPTED` with
  `lease_expired`; lease material is cleared. They are never resumed, requeued
  or assigned a reused lease. Rerun verification with
  `TASKTWIN_RESTORE_REQUIRE_RECOVERED_RUNS=true` after reconciliation.
- Notification Worker reclaims expired processing leases. In-app delivery uses
  its existing unique alert/recipient identity, retaining at-least-once
  processing with idempotent visible delivery.
- Runners use their existing bounded reconnect loop and authenticate normally.
  Restore adds no reconnect command and sends no remote shell/update action.
- Release catalog, desired release and rollout state are preserved exactly.
  Recovery does not promote, install, roll back or alter desired state.

## Repeatable drill

Run `pnpm dr:drill` with Docker. It creates two disposable PostgreSQL 17
databases, applies real migrations, seeds representative audit, expired-run,
notification, Runner, release and rollout state, backs up, verifies checksum,
restores cleanly, reruns migrations, verifies both audit chains, starts API
readiness, performs an authenticated Runner heartbeat, interrupts the expired
run and proves notification delivery idempotency. Temporary containers,
networks, volumes, files and generated credentials are removed in `finally`.

Record output, duration and operator/date for production drills. Run at least
quarterly and after material persistence or recovery changes.

## Limitations

There is no continuous WAL archiving, point-in-time recovery, replication, HA,
cloud backup service, automatic failover or automatic off-host copy. Restore
applies forward migrations only. Prisma migrations and data transformations are
not automatically rolled back; recover a failed deployment by restoring its
pre-deployment backup into a new database and explicitly switching after
verification.
