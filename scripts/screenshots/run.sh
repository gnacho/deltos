#!/bin/sh
# Regenerate the README and landing screenshots against a throwaway instance.
#
#   scripts/screenshots/run.sh --binary /path/to/deltos-go            # shots in a temp dir
#   scripts/screenshots/run.sh --binary /path/to/deltos-go --write    # overwrite repo assets
#
# The instance uses a temporary DATA_DIR and synthetic data (see seed.py), so
# nothing touches a real database. Requires python3 with requests and
# Playwright for Python, plus ImageMagick for the landing WebPs.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
BINARY=""
PORT=3998
OUT=""
WRITE=0

while [ $# -gt 0 ]; do
    case "$1" in
        --binary) BINARY=$2; shift 2 ;;
        --port) PORT=$2; shift 2 ;;
        --out) OUT=$2; shift 2 ;;
        --write) WRITE=1; shift ;;
        -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

[ -n "$BINARY" ] || { echo "--binary is required (build it with: cd server-go && go build -o /tmp/deltos-go ./cmd/server)" >&2; exit 2; }
[ -x "$BINARY" ] || { echo "not executable: $BINARY" >&2; exit 2; }

command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 2; }
[ "$WRITE" -eq 1 ] && ! command -v magick >/dev/null && { echo "--write needs ImageMagick (magick)" >&2; exit 2; }

TMP=$(mktemp -d)
[ -n "$OUT" ] || OUT="$TMP/shots"
mkdir -p "$OUT" "$TMP/data"

DATA_DIR="$TMP/data" \
PORT="$PORT" \
STATIC_DIR="$ROOT/app/dist" \
AUTH_USER=admin \
AUTH_PASS=screenshots-pass \
SESSION_SECRET=screenshots-secret-0123456789abcdef \
COOKIE_SECURE=false \
    "$BINARY" >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; rm -rf "$TMP"' EXIT INT TERM

echo "waiting for the server on :$PORT"
i=0
while [ "$i" -lt 40 ]; do
    if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
    i=$((i + 1))
    sleep 0.5
done
if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "server did not become healthy" >&2
    tail -20 "$TMP/server.log" >&2
    exit 1
fi

python3 "$HERE/seed.py" --base "http://127.0.0.1:$PORT" --out "$TMP/state.json"
python3 "$HERE/capture.py" --base "http://127.0.0.1:$PORT" --state "$TMP/state.json" --out "$OUT"

if [ "$WRITE" -eq 1 ]; then
    for lang in en es; do
        for theme in light dark; do
            cp "$OUT/$lang-$theme-board.png" "$ROOT/assets/hero-$lang-$theme.png"
            for subject in task settings rewards expenses; do
                cp "$OUT/$lang-$theme-$subject.png" "$ROOT/assets/screenshot-$subject-$lang-$theme.png"
            done
            for subject in board casa viaje trabajo expenses rewards invite settings; do
                magick "$OUT/$lang-$theme-$subject.png" -resize 1440x900 -quality 82 \
                    "$ROOT/landing/assets/shot-$subject-$lang-$theme.webp"
            done
        done
    done
    echo "assets overwritten in assets/ and landing/assets/"
fi

echo "screenshots in $OUT"
