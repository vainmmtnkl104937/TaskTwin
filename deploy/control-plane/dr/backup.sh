#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

umask 077

BACKUP_FORMAT_VERSION=1
BACKUP_ROOT=${TASKTWIN_BACKUP_ROOT:-/backups}
BACKUP_REASON=${TASKTWIN_BACKUP_REASON:-manual}
PGHOST=${PGHOST:-postgres}
PGPORT=${PGPORT:-5432}
POSTGRES_USER=${POSTGRES_USER:-}
POSTGRES_DB=${POSTGRES_DB:-}
PASSWORD_FILE=${TASKTWIN_POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}

case "$BACKUP_REASON" in
  scheduled|predeploy|manual|drill) ;;
  *) fail 'BACKUP_REASON_INVALID' ;;
esac
case "$PGPORT" in *[!0-9]*|'') fail 'BACKUP_PORT_INVALID' ;; esac
[ "$PGPORT" -ge 1 ] && [ "$PGPORT" -le 65535 ] || fail 'BACKUP_PORT_INVALID'
[ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_DB" ] || fail 'BACKUP_DATABASE_IDENTITY_REQUIRED'
printf '%s' "$POSTGRES_USER$POSTGRES_DB$PGHOST" | grep -Eq '^[A-Za-z0-9_.:-]+$' || fail 'BACKUP_DATABASE_IDENTITY_INVALID'
[ -d "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ] || fail 'BACKUP_ROOT_INVALID'
[ -f "$PASSWORD_FILE" ] && [ ! -L "$PASSWORD_FILE" ] || fail 'BACKUP_PASSWORD_FILE_INVALID'
[ "$(wc -c < "$PASSWORD_FILE")" -le 4096 ] || fail 'BACKUP_PASSWORD_FILE_TOO_LARGE'

TIMESTAMP=${TASKTWIN_BACKUP_TIMESTAMP_UTC:-$(date -u '+%Y%m%dT%H%M%SZ')}
printf '%s' "$TIMESTAMP" | grep -Eq '^[0-9]{8}T[0-9]{6}Z$' || fail 'BACKUP_TIMESTAMP_INVALID'
BASE="tasktwin-postgresql-v${BACKUP_FORMAT_VERSION}-${TIMESTAMP}-${BACKUP_REASON}"
DUMP="$BACKUP_ROOT/$BASE.dump"
PARTIAL="$DUMP.partial"
CHECKSUM="$DUMP.sha256"
METADATA="$DUMP.json"
[ ! -e "$DUMP" ] && [ ! -e "$PARTIAL" ] && [ ! -e "$CHECKSUM" ] && [ ! -e "$METADATA" ] || fail 'BACKUP_ARTIFACT_EXISTS'

PGPASS=$(mktemp /tmp/tasktwin-backup-pgpass.XXXXXX)
cleanup() {
  rm -f "$PGPASS" "$PARTIAL" "$CHECKSUM.partial" "$METADATA.partial"
}
trap cleanup EXIT HUP INT TERM
PASSWORD=$(tr -d '\r\n' < "$PASSWORD_FILE")
[ -n "$PASSWORD" ] || fail 'BACKUP_PASSWORD_EMPTY'
ESCAPED_PASSWORD=$(printf '%s' "$PASSWORD" | sed 's/\\/\\\\/g; s/:/\\:/g')
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$POSTGRES_DB" "$POSTGRES_USER" "$ESCAPED_PASSWORD" > "$PGPASS"
unset PASSWORD ESCAPED_PASSWORD
export PGPASSFILE="$PGPASS"

pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --format=custom \
  --compress=gzip:6 \
  --no-owner \
  --no-privileges \
  --file="$PARTIAL" || fail 'BACKUP_DUMP_FAILED'

pg_restore --list "$PARTIAL" >/dev/null || fail 'BACKUP_ARCHIVE_INVALID'
SIZE=$(wc -c < "$PARTIAL" | tr -d ' ')
[ "$SIZE" -gt 0 ] || fail 'BACKUP_ARCHIVE_EMPTY'
SHA256=$(sha256sum "$PARTIAL" | awk '{print $1}')
printf '%s  %s\n' "$SHA256" "$BASE.dump" > "$CHECKSUM.partial"

MIGRATION_COUNT=$(psql --host="$PGHOST" --port="$PGPORT" --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --command="SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" | tr -d '[:space:]')
case "$MIGRATION_COUNT" in *[!0-9]*|'') fail 'BACKUP_MIGRATION_STATE_UNAVAILABLE' ;; esac
printf '{\n  "formatVersion": %s,\n  "createdAtUtc": "%s",\n  "reason": "%s",\n  "database": "%s",\n  "sizeBytes": %s,\n  "sha256": "%s",\n  "completedMigrationCount": %s\n}\n' \
  "$BACKUP_FORMAT_VERSION" "$TIMESTAMP" "$BACKUP_REASON" "$POSTGRES_DB" "$SIZE" "$SHA256" "$MIGRATION_COUNT" > "$METADATA.partial"

mv "$PARTIAL" "$DUMP"
mv "$CHECKSUM.partial" "$CHECKSUM"
mv "$METADATA.partial" "$METADATA"
trap - EXIT HUP INT TERM
rm -f "$PGPASS"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TASKTWIN_BACKUP_ROOT="$BACKUP_ROOT" sh "$SCRIPT_DIR/retention.sh"
printf 'BACKUP_COMPLETE artifact=%s sizeBytes=%s reason=%s\n' "$BASE.dump" "$SIZE" "$BACKUP_REASON"
