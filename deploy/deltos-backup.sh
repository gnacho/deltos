#!/usr/bin/env bash
# Backup diario de Deltos. Delega en el CLI de Node (server/src/backup-cli.js),
# que usa la API online de SQLite para un snapshot consistente aunque la BD esté
# en WAL y el servidor esté escribiendo. Antes hacía `cp` del fichero, que con
# WAL puede dejar una copia inconsistente (se pierde el -wal).
set -euo pipefail

DATA_DIR="${1:-/opt/deltos/data}"
DB_PATH="$DATA_DIR/app.db"

if [ ! -f "$DB_PATH" ]; then
  echo "Error: $DB_PATH no existe" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="${NODE_BIN:-node}"

exec "$NODE_BIN" "$SCRIPT_DIR/../server/src/backup-cli.js" "$DATA_DIR"
