#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

BACKUP_ROOT=${TASKTWIN_BACKUP_ROOT:-/backups}
[ -d "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ] || fail 'RETENTION_ROOT_INVALID'

retain_class() {
  reason=$1
  keep=$2
  count=0
  find "$BACKUP_ROOT" -maxdepth 1 -type f -name "tasktwin-postgresql-v1-????????T??????Z-${reason}.dump" -print \
    | sort -r \
    | while IFS= read -r dump; do
        count=$((count + 1))
        [ "$count" -le "$keep" ] && continue
        [ ! -L "$dump" ] || fail 'RETENTION_SYMLINK_REJECTED'
        checksum="$dump.sha256"
        metadata="$dump.json"
        [ -f "$checksum" ] && [ ! -L "$checksum" ] || fail 'RETENTION_INCOMPLETE_SET'
        [ -f "$metadata" ] && [ ! -L "$metadata" ] || fail 'RETENTION_INCOMPLETE_SET'
        rm -f -- "$dump" "$checksum" "$metadata"
      done
}

retain_class scheduled 14
retain_class predeploy 5
retain_class manual 5
retain_class drill 3

find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'tasktwin-postgresql-v1-*.dump.partial' -mtime +0 -delete
printf '%s\n' 'RETENTION_COMPLETE'
