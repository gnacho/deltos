#!/bin/sh
# deltos-update.sh — aplica la última release ESTABLE de Deltos.
# Patrón app-auto-update (variante Node), layout CAPISTRANO:
#   /opt/deltos/current -> releases/v<ver>   (rollback por symlink)
# NUNCA toca datos: el SQLite vive en $STATE_DIR (/var/lib/deltos), fuera de
# releases/. El marker /opt/deltos/.release-id es la fuente de verdad de la
# versión instalada (server/src/update.js la lee para /api/update/status).
set -eu

APP=deltos
REPO=gnacho/deltos
ARCH="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
OPT_DIR=/opt/deltos
STATE_DIR=/var/lib/deltos
MARKER="$OPT_DIR/.release-id"
CONF_DIR=/etc/deltos
ENV_FILE="$CONF_DIR/env"
SERVICE_NAME=deltos
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

log() { logger -t "$APP-update" "$@"; }

echo "STEP:detect"
VER="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | sed -n 's/.*"tag_name": *"\(v\?[0-9][^"]*\)".*/\1/p' | head -n1)"
[ -n "$VER" ] || { log "no se pudo resolver release latest"; exit 4; }
VER_NO_V="$(printf '%s' "$VER" | sed 's/^v//')"

# Marker semver real (fuente de verdad para /api/update/status).
if [ -f "$MARKER" ] && [ "$(cat "$MARKER" 2>/dev/null || true)" = "$VER_NO_V" ]; then
  log "al día ($VER_NO_V)"; exit 0
fi

# PORT del env actual (el deploy del service lo lee de EnvironmentFile).
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | head -1)"
PORT="${PORT:-8080}"

echo "STEP:download"
TARBALL="deltos_${VER_NO_V}_linux_${ARCH}.tar.gz"
BASE="https://github.com/$REPO/releases/download/$VER"
curl -fL "$BASE/$TARBALL" -o "$TMP_DIR/app.tar.gz"
curl -fL "$BASE/checksums.txt" -o "$TMP_DIR/checksums.txt"

echo "STEP:verify"
expected="$(awk -v f="$TARBALL" '$0 ~ f {print $1; exit}' "$TMP_DIR/checksums.txt")"
[ -n "$expected" ] || { log "checksums.txt sin entrada para $TARBALL"; exit 5; }
got="$(sha256sum "$TMP_DIR/app.tar.gz" | awk '{print $1}')"
[ "$expected" = "$got" ] || { log "SHA256 NO coincide ($TARBALL)"; exit 5; }

echo "STEP:extract"
RELEASE_DIR="$OPT_DIR/releases/v$VER_NO_V"
[ -d "$RELEASE_DIR" ] || mkdir -p "$RELEASE_DIR"
tar -xzf "$TMP_DIR/app.tar.gz" -C "$RELEASE_DIR"

echo "STEP:node"
# Deps de producción: el tarball ya trae node_modules del arch correcto (CI).
# Si cambió package.json, reinstalar como el usuario del servicio (nunca root).
if [ -f "$RELEASE_DIR/server/package.json" ]; then
  PREV_PKG="$(readlink -f "$OPT_DIR/current" 2>/dev/null || echo)/server/package.json"
  if [ ! -f "$PREV_PKG" ] || ! diff -q "$PREV_PKG" "$RELEASE_DIR/server/package.json" >/dev/null 2>&1; then
    chown -R "$APP:$APP" "$RELEASE_DIR"
    su -s /bin/sh "$APP" -c "cd $RELEASE_DIR/server && npm ci --omit=dev --no-audit --no-fund" \
      || { log "npm ci falló en $RELEASE_DIR"; exit 6; }
  fi
fi

echo "STEP:deploy"
# Cambia el symlink current -> nueva release (rollback: apuntar a la anterior).
chown -R "$APP:$APP" "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$OPT_DIR/current"
# Poda de releases antiguas: conserva las 2 anteriores además de la actual.
ls -1dt "$OPT_DIR"/releases/v* 2>/dev/null | tail -n +4 | while read -r old; do
  rm -rf "$old"
done

echo "STEP:restart"
printf '%s' "$VER_NO_V" > "$MARKER"
chmod 0644 "$MARKER"
if [ "${SKIP_RESTART:-0}" != "1" ]; then
  systemctl restart "$SERVICE_NAME"
fi
log "actualizado a $VER_NO_V (port $PORT)"

# Rollback manual:
#   ls /opt/deltos/releases   (elige la anterior)
#   ln -sfn /opt/deltos/releases/v<prev> /opt/deltos/current && systemctl restart deltos
