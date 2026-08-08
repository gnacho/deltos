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
TS="$(date +%s)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

log() { logger -t "$APP-update" "$@"; }

echo "STEP:detect"
VER="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | sed -n 's/.*"tag_name": *"\(v\?[0-9][^"]*\)".*/\1/p' | head -n1)"
[ -n "$VER" ] || { log "no se pudo resolver release latest"; exit 4; }
VER_NO_V="$(printf '%s' "$VER" | sed 's/^v//')"

# Limpiar el flag on-demand cuanto antes (lo escribe el apply in-app y systemd
# .path nos lanzó al detectarlo). Así una próxima petición puede re-disparar.
# Ambos layouts por si acaso.
rm -f /var/lib/deltos/.update-requested /opt/deltos/data/.update-requested 2>/dev/null || true

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
# cache-buster en checksums.txt: la URL es estable entre versiones y la CDN
# cachea el fichero viejo justo tras publicar una release, lo que haría
# fallar la verificación (bug real, issue #38).
curl -fL "$BASE/checksums.txt?nc=$TS" -o "$TMP_DIR/checksums.txt"

echo "STEP:verify"
expected="$(awk -v f="$TARBALL" '$0 ~ f {print $1; exit}' "$TMP_DIR/checksums.txt")"
[ -n "$expected" ] || { log "checksums.txt sin entrada para $TARBALL"; exit 5; }
got="$(sha256sum "$TMP_DIR/app.tar.gz" | awk '{print $1}')"
[ "$expected" = "$got" ] || { log "SHA256 NO coincide ($TARBALL)"; exit 5; }

echo "STEP:extract"
mkdir -p "$TMP_DIR/pkg"
tar -xzf "$TMP_DIR/app.tar.gz" -C "$TMP_DIR/pkg"

echo "STEP:deploy"
# Dos layouts posibles:
#  - Capistrano (install.sh): /opt/deltos/current → releases/vX, datos en /var/lib/deltos.
#  - Plano (deploy manual CT 226): /opt/deltos/{server,app/dist}, datos en /opt/deltos/data.
if [ -L "$OPT_DIR/current" ]; then
  # Capistrano: nueva release + flip de symlink (la anterior queda intacta = rollback).
  RELEASE_DIR="$OPT_DIR/releases/v$VER_NO_V"
  mkdir -p "$RELEASE_DIR"
  cp -a "$TMP_DIR/pkg/dist" "$RELEASE_DIR/dist"
  cp -a "$TMP_DIR/pkg/server" "$RELEASE_DIR/server"
  cp -a "$TMP_DIR/pkg/install.sh" "$RELEASE_DIR/install.sh" 2>/dev/null || true
  cp -a "$TMP_DIR/pkg/deploy" "$RELEASE_DIR/deploy" 2>/dev/null || true
  chown -R "$APP:$APP" "$RELEASE_DIR"
  ln -sfn "$RELEASE_DIR" "$OPT_DIR/current"
  [ -x "$OPT_DIR/node/bin/node" ] && ln -sfn "$OPT_DIR/node/bin/node" "$RELEASE_DIR/server/node" 2>/dev/null || true
  # Poda de releases antiguas: conserva las 2 anteriores además de la actual.
  ls -1dt "$OPT_DIR"/releases/v* 2>/dev/null | tail -n +4 | while read -r old; do
    rm -rf "$old"
  done
else
  # Plano: backup + reemplazo quirúrgico (preserva .env y config local).
  # NUNCA volar server/ entero: el .env (DATA_DIR/PORT/VAPID) y otros ficheros
  # locales viven ahí y el tarball NO los trae (bug #40: rm -rf server dejaba
  # el servicio en crash-loop). Se reemplaza SOLO el código.
  [ -d "$OPT_DIR/app/dist" ] && cp -a "$OPT_DIR/app/dist" "$OPT_DIR/app.dist.bak-$TS"
  [ -d "$OPT_DIR/server" ] && cp -a "$OPT_DIR/server" "$OPT_DIR/server.bak-$TS"
  # dist: reemplazo completo (no hay config local ahí).
  rm -rf "$OPT_DIR/app/dist"
  mkdir -p "$OPT_DIR/app/dist"
  cp -a "$TMP_DIR/pkg/dist/." "$OPT_DIR/app/dist/"
  # server: reemplazar src, node_modules y package.json; dejar .env intacto.
  rm -rf "$OPT_DIR/server/src"
  cp -a "$TMP_DIR/pkg/server/src" "$OPT_DIR/server/src"
  if [ -d "$TMP_DIR/pkg/server/node_modules" ]; then
    rm -rf "$OPT_DIR/server/node_modules"
    cp -a "$TMP_DIR/pkg/server/node_modules" "$OPT_DIR/server/node_modules"
  fi
  cp "$TMP_DIR/pkg/server/package.json" "$OPT_DIR/server/package.json"
  chown -R "$APP:$APP" "$OPT_DIR/app/dist" "$OPT_DIR/server/src" \
    "$OPT_DIR/server/node_modules" "$OPT_DIR/server/package.json" 2>/dev/null || true
fi
# Datos NUNCA se tocan: SQLite y uploads viven en $STATE_DIR (fuera de server/).

echo "STEP:restart"
printf '%s' "$VER_NO_V" > "$MARKER"
chmod 0644 "$MARKER"
if [ "${SKIP_RESTART:-0}" != "1" ]; then
  systemctl restart "$SERVICE_NAME"
fi
log "actualizado a $VER_NO_V (port $PORT)"

# Rollback manual (layout plano):
#   rm -rf /opt/deltos/{app/dist,server} && mv /opt/deltos/server.bak-$TS /opt/deltos/server \
#   && mv /opt/deltos/app.dist.bak-$TS /opt/deltos/app/dist && systemctl restart deltos
# Rollback manual (capistrano):
#   ln -sfn /opt/deltos/releases/v<prev> /opt/deltos/current && systemctl restart deltos
