#!/bin/sh
# =============================================================================
# Deltos — one-liner installer (Linux server)
#
#   Kanban PWA for shared tasks and boards (Node 22 + SQLite, frontend built).
#   Installs the versioned Node runtime + the app release (node_modules
#   pre-built) as a sandboxed systemd service.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/gnacho/deltos/main/install.sh | sh
#   sh install.sh --version=1.0.0 --unattended
#   sh install.sh --dry-run          # describe every step, touches nothing
#   sh install.sh --uninstall        # keeps /var/lib/deltos (data) and /etc/deltos
#   sh install.sh --uninstall --purge
#
# Requirements: Linux with systemd (Debian/Ubuntu/Fedora/Arch/...),
# amd64 / arm64. Verifies sha256 of every download (checksums.txt).
#
# Layout (capistrano-style):
#   /opt/deltos/node-v<ver>-linux-<arch>/   versioned Node runtime
#   /opt/deltos/node -> node-v<ver>...      runtime symlink
#   /opt/deltos/releases/v<ver>/            app release (server/ + dist/)
#   /opt/deltos/current -> releases/v<ver>  live symlink (update = flip, rollback = flip back)
#   /var/lib/deltos                         SQLite + uploads (StateDirectory)
#   /etc/deltos/env                         config (0600)
# =============================================================================
set -eu

APP_NAME="deltos"
GH_REPO="gnacho/deltos"
DESCRIPTION="Kanban PWA for shared tasks and boards"
DEFAULT_PORT="3000"
NODE_VERSION="22.23.2"
OPT_DIR="/opt/$APP_NAME"
STATE_DIR="/var/lib/$APP_NAME"
CONF_DIR="/etc/$APP_NAME"
ENV_FILE="$CONF_DIR/env"
SERVICE_NAME="$APP_NAME"

VERSION=""; UNATTENDED=0; DRY_RUN=0; UNINSTALL=0; PURGE=0

# ---------------------------------------------------------------- logging ---
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_G=$(printf '\033[32m'); C_R=$(printf '\033[31m'); C_Y=$(printf '\033[33m'); C_B=$(printf '\033[1m'); C_0=$(printf '\033[0m')
else C_G=""; C_R=""; C_Y=""; C_B=""; C_0=""; fi
info()  { printf '%s--%s %s\n' "$C_B" "$C_0" "$*"; }
ok()    { printf '%s✓%s %s\n' "$C_G" "$C_0" "$*"; }
warn()  { printf '%s!%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
err()   { printf '%s✗ %s%s\n' "$C_R" "$*" "$C_0" >&2; }
fatal() { _c=$1; shift; err "$*"; exit "$_c"; }
run()   { if [ "$DRY_RUN" -eq 1 ]; then info "[dry-run] $*"; else "$@"; fi; }

usage() {
    cat <<EOF
Deltos — installer ($DESCRIPTION)

Usage: sh install.sh [options]
  --version=X.Y.Z   version to install (default: latest stable release)
  --unattended      no questions (automatic when there's no TTY)
  --dry-run         describe each step without touching the system
  --uninstall       remove app and user (keeps $STATE_DIR and $CONF_DIR)
  --purge           with --uninstall: also remove data and configuration
  -h, --help        this help

Update = re-run this script (data and config are preserved).
Rollback: ln -sfn $OPT_DIR/releases/<previous-version> $OPT_DIR/current && systemctl restart $APP_NAME
Repo: https://github.com/$GH_REPO
EOF
    exit 0
}

for arg in "$@"; do
    case "$arg" in
        --version=*)  VERSION="${arg#*=}" ;;
        --unattended) UNATTENDED=1 ;;
        --dry-run)    DRY_RUN=1 ;;
        --uninstall)  UNINSTALL=1 ;;
        --purge)      PURGE=1 ;;
        -h|--help)    usage ;;
        *) fatal 10 "unknown option: $arg (try --help)" ;;
    esac
done
[ -t 0 ] || UNATTENDED=1   # pipe-to-shell: never prompt

# -------------------------------------------------------------- elevation ---
if [ "$(id -u)" -eq 0 ]; then SUDO=""
elif command -v sudo >/dev/null 2>&1; then SUDO="sudo -E"
elif command -v doas >/dev/null 2>&1; then SUDO="doas"
else fatal 22 "I need root (or sudo/doas). Download the script and run it as root: su -c 'sh install.sh'"
fi

# --------------------------------------------------------------- uninstall --
if [ "$UNINSTALL" -eq 1 ]; then
    info "uninstalling $APP_NAME"
    if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
        run $SUDO systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        run $SUDO systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        run $SUDO rm -f "/etc/systemd/system/$SERVICE_NAME.service"
        run $SUDO systemctl daemon-reload
        ok "systemd unit removed"
    fi
    run $SUDO rm -rf "$OPT_DIR"
    ok "$OPT_DIR removed"
    if id "$APP_NAME" >/dev/null 2>&1; then
        run $SUDO userdel "$APP_NAME" 2>/dev/null || warn "could not delete user $APP_NAME"
        ok "system user removed"
    fi
    if [ "$PURGE" -eq 1 ]; then
        run $SUDO rm -rf "$STATE_DIR" "$CONF_DIR"
        ok "data and configuration removed (--purge)"
    else
        info "data kept: $STATE_DIR · config: $CONF_DIR (remove with --purge)"
    fi
    ok "$APP_NAME uninstalled"
    exit 0
fi

# --------------------------------------------------------------- detection --
. /etc/os-release 2>/dev/null || true
OS_PRETTY="${PRETTY_NAME:-$(uname -s)}"

ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)  REL_ARCH=amd64; NODE_ARCH=x64 ;;
    aarch64|arm64) REL_ARCH=arm64; NODE_ARCH=arm64 ;;
    *) fatal 20 "unsupported architecture: $ARCH (released: amd64, arm64)"
esac

if [ ! -d /run/systemd/system ] || ! command -v systemctl >/dev/null 2>&1; then
    fatal 23 "Deltos needs systemd (this machine doesn't run it). See https://github.com/$GH_REPO for manual setup"
fi
info "detected: $OS_PRETTY · linux/$REL_ARCH · systemd"

if command -v curl >/dev/null 2>&1; then FETCH="curl -fsSL --retry 3 --connect-timeout 10"
elif command -v wget >/dev/null 2>&1; then FETCH="wget -q -O-"
else fatal 21 "I need curl or wget (install it with your package manager)"
fi
fetch_to() { $FETCH "$1" > "$2"; }
for tool in sha256sum tar xz; do command -v "$tool" >/dev/null 2>&1 || fatal 21 "missing tool: $tool"; done

# --------------------------------------------------------- resolve version --
if [ -z "$VERSION" ]; then
    info "resolving latest stable version"
    VERSION=$($FETCH "https://api.github.com/repos/$GH_REPO/releases/latest" \
        | grep '"tag_name"' | head -1 | cut -d'"' -f4) \
        || fatal 31 "could not resolve the latest version (GitHub rate-limit?). Use --version=X.Y.Z"
    [ -n "$VERSION" ] || fatal 31 "no stable release found yet. Use --version=X.Y.Z"
fi
VERSION_NORM=$(echo "$VERSION" | sed 's/^v//')
ASSET="${APP_NAME}_${VERSION_NORM}_linux_${REL_ARCH}.tar.gz"
BASE_URL="https://github.com/$GH_REPO/releases/download/$VERSION"
info "version: $VERSION"

# connectivity pre-flight BEFORE touching the system
$FETCH "https://github.com/$GH_REPO" >/dev/null \
    || fatal 30 "no access to github.com (proxy? DNS? firewall?)"

UPGRADING=0
[ -L "$OPT_DIR/current" ] && { UPGRADING=1; info "previous install detected: upgrade mode (data and config are preserved)"; }

# ---------------------------------------------------------- download+verify --
TMP=$(mktemp -d) || fatal 34 "mktemp failed"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

info "downloading $ASSET"
fetch_to "$BASE_URL/$ASSET" "$TMP/$ASSET" || fatal 32 "download failed: $BASE_URL/$ASSET"
fetch_to "$BASE_URL/checksums.txt" "$TMP/checksums.txt" || fatal 32 "checksums.txt not found in release $VERSION"
[ -s "$TMP/$ASSET" ] || fatal 32 "downloaded asset is empty"

SUM_FILE=$(sha256sum "$TMP/$ASSET" | awk '{print $1}')
SUM_REF=$(grep "  $ASSET\$" "$TMP/checksums.txt" | awk '{print $1}')
[ -n "$SUM_REF" ] || fatal 33 "$ASSET not listed in checksums.txt"
[ "$SUM_FILE" = "$SUM_REF" ] || fatal 33 "sha256 MISMATCH for $ASSET — corrupt or tampered download"
ok "sha256 verified"
tar -tzf "$TMP/$ASSET" >/dev/null 2>&1 || fatal 34 "tarball is corrupt"

# -------------------------------------------------------------- Node runtime --
NODE_DIR="node-v${NODE_VERSION}-linux-${NODE_ARCH}"
if [ ! -x "$OPT_DIR/$NODE_DIR/bin/node" ]; then
    info "installing Node runtime v$NODE_VERSION ($NODE_ARCH)"
    fetch_to "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIR}.tar.xz" "$TMP/node.tar.xz" \
        || fatal 35 "Node download failed"
    fetch_to "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" "$TMP/SHASUMS256.txt" \
        || fatal 35 "SHASUMS256.txt download failed"
    NSUM=$(sha256sum "$TMP/node.tar.xz" | awk '{print $1}')
    NREF=$(grep "  ${NODE_DIR}.tar.xz\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')
    [ "$NSUM" = "$NREF" ] || fatal 35 "sha256 MISMATCH for the Node runtime"
    run $SUDO install -d -m 0755 "$OPT_DIR"
    run $SUDO tar -xJf "$TMP/node.tar.xz" -C "$OPT_DIR"
    ok "Node v$NODE_VERSION verified and installed"
else
    ok "Node v$NODE_VERSION already present"
fi
run $SUDO ln -sfn "$OPT_DIR/$NODE_DIR" "$OPT_DIR/node"
NODE_BIN="$OPT_DIR/node/bin/node"

# --------------------------------------------------------------------- user --
if ! id "$APP_NAME" >/dev/null 2>&1; then
    run $SUDO useradd --system --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$APP_NAME"
    ok "system user $APP_NAME created"
fi
run $SUDO install -d -m 0750 -o "$APP_NAME" -g "$APP_NAME" "$STATE_DIR"
run $SUDO install -d -m 0750 "$CONF_DIR"

# ------------------------------------------------------------ install release --
RELEASE_DIR="$OPT_DIR/releases/v$VERSION_NORM"
run $SUDO install -d -m 0755 "$RELEASE_DIR"
run $SUDO tar -xzf "$TMP/$ASSET" -C "$RELEASE_DIR"
run $SUDO chown -R "$APP_NAME:$APP_NAME" "$RELEASE_DIR"
run $SUDO ln -sfn "$RELEASE_DIR" "$OPT_DIR/current"
ok "release v$VERSION_NORM at $RELEASE_DIR (current -> it)"

# Initial config ONLY on fresh install (upgrades never touch credentials)
if [ ! -f "$ENV_FILE" ]; then
    ADMIN_PASS=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 16)
    if [ "$DRY_RUN" -eq 1 ]; then info "[dry-run] would generate $ENV_FILE (0600, random admin password)"; else
        $SUDO tee "$ENV_FILE" >/dev/null <<EOF
PORT=$DEFAULT_PORT
AUTH_USER=admin
AUTH_PASS=$ADMIN_PASS
DATA_DIR=$STATE_DIR
STATIC_DIR=$OPT_DIR/current/dist
EOF
        $SUDO chmod 0600 "$ENV_FILE"
        $SUDO chown "$APP_NAME:$APP_NAME" "$ENV_FILE"
    fi
    FRESH_CREDENTIALS=1
else
    FRESH_CREDENTIALS=0
    info "existing config kept ($ENV_FILE)"
fi

# ----------------------------------------------------------------- service --
if [ "$DRY_RUN" -eq 1 ]; then info "[dry-run] would write systemd unit + enable --now"; else
    $SUDO tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null <<EOF
[Unit]
Description=Deltos — $DESCRIPTION
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_NAME
Group=$APP_NAME
WorkingDirectory=$OPT_DIR/current
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN server/src/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
LockPersonality=true
RemoveIPC=true
StateDirectory=$APP_NAME
ReadWritePaths=$STATE_DIR
UMask=007

[Install]
WantedBy=multi-user.target
EOF
fi
run $SUDO systemctl daemon-reload
if [ "$UPGRADING" -eq 1 ]; then run $SUDO systemctl restart "$SERVICE_NAME"
else run $SUDO systemctl enable --now "$SERVICE_NAME"; fi

if [ "$DRY_RUN" -eq 0 ]; then
    sleep 3
    if ! $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
        err "service failed to start; diagnostics:"
        $SUDO systemctl status "$SERVICE_NAME" --no-pager || true
        $SUDO journalctl -u "$SERVICE_NAME" -n 50 --no-pager || true
        exit 40
    fi
    ok "service $SERVICE_NAME active"
    if command -v curl >/dev/null 2>&1; then
        curl -fsS --max-time 5 "http://127.0.0.1:$DEFAULT_PORT/health" >/dev/null 2>&1 \
            && ok "HTTP health check OK on :$DEFAULT_PORT" \
            || warn "service is up but http://127.0.0.1:$DEFAULT_PORT didn't answer yet (give it a few seconds)"
    fi
fi

# ------------------------------------------------------------------ summary --
printf '\n%s================ %s installed ================%s\n' "$C_G" "$APP_NAME" "$C_0"
printf 'Version:  %s%s\n' "$VERSION" "$( [ "$UPGRADING" -eq 1 ] && echo ' (upgrade)' || true)"
printf 'App:      %s -> %s\n' "$OPT_DIR/current" "$RELEASE_DIR"
printf 'Node:     %s\n' "$NODE_BIN"
printf 'Data:     %s\n' "$STATE_DIR"
printf 'Access:   http://<this-machine-ip>:%s\n' "$DEFAULT_PORT"
if [ "${FRESH_CREDENTIALS:-0}" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
    printf '\nInitial credentials (shown ONCE — change them after logging in):\n'
    printf '  user:     admin\n  password: %s\n' "$ADMIN_PASS"
fi
printf '\nUseful commands:\n'
printf '  systemctl status %s\n  journalctl -u %s -f\n' "$SERVICE_NAME" "$SERVICE_NAME"
printf '  sh install.sh              # update to the latest stable version\n'
printf '  sh install.sh --uninstall\n'
printf '\nNotes:\n'
printf '  - No firewall port was opened. If you need one:\n'
printf '      firewall-cmd --permanent --add-port=%s/tcp && firewall-cmd --reload\n' "$DEFAULT_PORT"
printf '      ufw allow %s/tcp\n' "$DEFAULT_PORT"
printf '  - Behind an HTTPS reverse proxy, add COOKIE_SECURE=true to %s\n' "$ENV_FILE"
printf '  - Rollback: ln -sfn %s/releases/<previous> %s/current && systemctl restart %s\n' "$OPT_DIR" "$OPT_DIR" "$SERVICE_NAME"
printf '%s================================================%s\n\n' "$C_G" "$C_0"
