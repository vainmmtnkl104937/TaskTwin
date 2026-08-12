#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

umask 077
BACKUP_ROOT=${TASKTWIN_BACKUP_ROOT:-/backups}
BACKUP_REF=${TASKTWIN_RESTORE_BACKUP_REF:-}
PGHOST=${PGHOST:-postgres}
PGPORT=${PGPORT:-5432}
POSTGRES_USER=${POSTGRES_USER:-}
POSTGRES_DB=${POSTGRES_DB:-}
PASSWORD_FILE=${TASKTWIN_POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}
CONFIRM_DATABASE=${TASKTWIN_RESTORE_CONFIRM_DATABASE:-}

printf '%s' "$BACKUP_REF" | grep -Eq '^tasktwin-postgresql-v1-[0-9]{8}T[0-9]{6}Z-(scheduled|predeploy|manual|drill)\.dump$' || fail 'RESTORE_REFERENCE_INVALID'
[ "$CONFIRM_DATABASE" = "$POSTGRES_DB" ] && [ -n "$POSTGRES_DB" ] || fail 'RESTORE_DATABASE_CONFIRMATION_REQUIRED'
case "$PGPORT" in *[!0-9]*|'') fail 'RESTORE_PORT_INVALID' ;; esac
printf '%s' "$POSTGRES_USER$POSTGRES_DB$PGHOST" | grep -Eq '^[A-Za-z0-9_.:-]+$' || fail 'RESTORE_DATABASE_IDENTITY_INVALID'
[ -d "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ] || fail 'RESTORE_ROOT_INVALID'
[ -f "$PASSWORD_FILE" ] && [ ! -L "$PASSWORD_FILE" ] && [ "$(wc -c < "$PASSWORD_FILE")" -le 4096 ] || fail 'RESTORE_PASSWORD_FILE_INVALID'

DUMP="$BACKUP_ROOT/$BACKUP_REF"
CHECKSUM="$DUMP.sha256"
METADATA="$DUMP.json"
for file in "$DUMP" "$CHECKSUM" "$METADATA"; do
  [ -f "$file" ] && [ ! -L "$file" ] || fail 'RESTORE_ARTIFACT_SET_INVALID'
done
EXPECTED_LINE=$(cat "$CHECKSUM")
EXPECTED_SHA=$(printf '%s' "$EXPECTED_LINE" | awk '{print $1}')
EXPECTED_NAME=$(printf '%s' "$EXPECTED_LINE" | awk '{print $2}')
[ "$EXPECTED_NAME" = "$BACKUP_REF" ] || fail 'RESTORE_CHECKSUM_NAME_MISMATCH'
printf '%s' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{64}$' || fail 'RESTORE_CHECKSUM_INVALID'
ACTUAL_SHA=$(sha256sum "$DUMP" | awk '{print $1}')
[ "$EXPECTED_SHA" = "$ACTUAL_SHA" ] || fail 'RESTORE_CHECKSUM_MISMATCH'
grep -Fq '"formatVersion": 1' "$METADATA" || fail 'RESTORE_METADATA_INVALID'
grep -Fq "\"sha256\": \"$ACTUAL_SHA\"" "$METADATA" || fail 'RESTORE_METADATA_MISMATCH'
EXPECTED_SIZE=$(sed -n 's/.*"sizeBytes": \([0-9][0-9]*\).*/\1/p' "$METADATA")
ACTUAL_SIZE=$(wc -c < "$DUMP" | tr -d ' ')
[ -n "$EXPECTED_SIZE" ] && [ "$EXPECTED_SIZE" = "$ACTUAL_SIZE" ] || fail 'RESTORE_SIZE_MISMATCH'
pg_restore --list "$DUMP" >/dev/null || fail 'RESTORE_ARCHIVE_INVALID'

PGPASS=$(mktemp /tmp/tasktwin-restore-pgpass.XXXXXX)
cleanup() { rm -f "$PGPASS"; }
trap cleanup EXIT HUP INT TERM
PASSWORD=$(tr -d '\r\n' < "$PASSWORD_FILE")
[ -n "$PASSWORD" ] || fail 'RESTORE_PASSWORD_EMPTY'
ESCAPED_PASSWORD=$(printf '%s' "$PASSWORD" | sed 's/\\/\\\\/g; s/:/\\:/g')
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$POSTGRES_DB" "$POSTGRES_USER" "$ESCAPED_PASSWORD" > "$PGPASS"
unset PASSWORD ESCAPED_PASSWORD
export PGPASSFILE="$PGPASS"

RELATION_COUNT=$(psql --host="$PGHOST" --port="$PGPORT" --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --command="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')" | tr -d '[:space:]')
[ "$RELATION_COUNT" = 0 ] || fail 'RESTORE_TARGET_NOT_CLEAN'

pg_restore \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "$DUMP" || fail 'RESTORE_FAILED'

printf 'RESTORE_COMPLETE artifact=%s database=%s\n' "$BACKUP_REF" "$POSTGRES_DB"
