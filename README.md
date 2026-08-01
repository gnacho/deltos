# Nido

> [Versión en español](README.es.md)

Task-management PWA for couples: a shared kanban board (New / In progress / Done)
with live sync between sessions (SSE), comments, attachments with an in-app image
viewer, activity feed, filters, light/dark mode, i18n (es/en) and installable as an app.

- **Backend** (`server/`): Node 22 + Hono + better-sqlite3 (WAL). Serves the API, the
  frontend statics and the SSE stream on the same port (no CORS).
- **Frontend** (`app/`): React 19 + Vite + Tailwind, built to `app/dist/`.

## Install (Linux server, one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/gnacho/nido/main/install.sh | sh
```

Detects your distro/arch (amd64, arm64), downloads the verified release (sha256
against `checksums.txt`), installs a versioned Node runtime and the app under
`/opt/nido`, creates a sandboxed `nido` systemd service and prints the initial
admin password. Requires systemd. Update = re-run the same line; remove with
`sh install.sh --uninstall`. Inspect first if you prefer:
`curl -fsSL …/install.sh -o install.sh && less install.sh`.

Releases are published per `v*` tag with `node_modules` pre-built per arch
(`.github/workflows/release.yml`) — no compiler needed on the server.

## Development

Requirement: Node ≥ 22.

```bash
# Backend (port 3000 by default; see server/.env.example)
cd server
npm ci
cp .env.example .env   # adjust AUTH_USER / AUTH_PASS
npm run dev            # or npm start

# Frontend (another terminal, proxied to the backend in dev)
cd app
npm ci
npm run dev

# Production frontend build (served by the backend itself)
npm run build
```

With `npm run build` done, the backend alone is enough: it serves the SPA from
`app/dist` with SPA fallback.

## Credentials

- **Production**: first boot creates the admin from `AUTH_USER` / `AUTH_PASS`
  (idempotent; if `AUTH_PASS` is missing, **no** admin is created and a warning is
  logged). In `.env.example`: `admin` / `cambia-esta-password`.
- **Demo**: "Sign in as demo" button on the login screen (no password). Separate demo
  database (`app_demo.db`), seeded with 3 users, 4 projects, 6 labels and 15 tasks.
  Can be disabled in Settings (admin only).

## Tests

```bash
cd server && npm test          # vitest: 30 API/auth/attachment tests
```

## Docker

```bash
docker build -t nido .
docker run -d --name nido -p 3000:3000 \
  -e AUTH_USER=admin -e AUTH_PASS='use-a-strong-password' \
  -v nido-data:/app/data \
  nido
```

- Multi-stage `node:22-slim` image: `npm ci --omit=dev` for the server + `server/` + `app/dist/`.
- Variables (see `server/src/config.js`): `PORT` (3000), `DATA_DIR` (`/app/data`),
  `STATIC_DIR` (`/app/app/dist`), `AUTH_USER`/`AUTH_PASS` (Dockerfile defaults:
  `admin` / `cambiar-1234` — **change them**), `COOKIE_SECURE` (`true` only behind HTTPS),
  `SESSION_SECRET` (optional; if missing it is auto-generated and persisted in the DB),
  `MAX_SSE_CLIENTS` (20), `MAX_UPLOAD_MB` (10).
- The `.env` file is **not** copied into the image: everything comes from defaults +
  container environment.
- Persistence: mount a volume at `/app/data` (SQLite + uploads).

## Deployment (systemd)

For VPS deployment with systemd + reverse proxy (Caddy/nginx with TLS and
`COOKIE_SECURE=true`). Minimal example unit:

```ini
[Unit]
Description=Nido
After=network.target

[Service]
WorkingDirectory=/opt/nido/server
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/nido
Environment=AUTH_USER=admin
Environment=AUTH_PASS=change-this
ExecStart=/usr/bin/node src/index.js
Restart=always
User=nido

[Install]
WantedBy=multi-user.target
```

## E2E

Playwright E2E verification (login/logout, SSE between two sessions, full task flow
with DnD and attachments, settings, mobile/desktop screenshots in light and dark mode):
7/7 tests green, 0 unexpected console errors. Screenshots in `e2e-screenshots/`.

## License

[AGPL-3.0](LICENSE)
