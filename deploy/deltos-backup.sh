#!/usr/bin/env bash
# deltis-backup.sh — copia de seguridad de la BD de Deltos.
# Diseñado para ejecutarse desde systemd timer o cron.
# Uso: deltis-backup.sh [DATA_DIR] [RETENTION_DAYS]
# Si no se pasan args, lee de /etc/deltos/env.
set -euo pipefail

DATA_DIR="${1:-}"
RETENTION_DAYS="${2:-7}"

if [ -z "$DATA_DIR" ]; then
  ENV_FILE="/etc/deltos/env"
  if [ -f "$ENV_FILE" ]; then
    # shellcheck source=/dev/null
    set -a; source "$ENV_FILE"; set +a
    DATA_DIR="${DATA_DIR:-/var/lib/deltos}"
  else
    echo "Error: DATA_DIR no especificado y $ENV_FILE no existe" >&2
    exit 1
  fi
fi

DB_PATH="$DATA_DIR/app.db"
BACKUPS_DIR="$DATA_DIR/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUPS_DIR/deltos-$TIMESTAMP.db"

mkdir -p "$BACKUPS_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "Error: $DB_PATH no existe" >&2
  exit 1
fi

if command -v sqlite3 &>/dev/null; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
  cp "$DB_PATH" "$BACKUP_FILE"
fi

echo "Backup creado: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%s 2>/dev/null || date -v-${RETENTION_DAYS}d +%s 2>/dev/null || echo 0)
if [ "$CUTOFF" != "0" ]; then
  find "$BACKUPS_DIR" -name "deltos-*.db" -type f -mmin +$((RETENTION_DAYS * 1440)) -delete 2>/dev/null || true
fi

echo "Backup completado OK"
