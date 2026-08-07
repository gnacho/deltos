# Deltos — server

Backend of **Deltos**, a task-management PWA for couples (multi-user).
Node 24 LTS (>=22) ESM · Hono 4 + @hono/node-server · better-sqlite3 (direct SQL, WAL) · bcryptjs · cookie · zod.

## Startup

```bash
cp .env.example .env      # adjust AUTH_USER / AUTH_PASS
npm install
npm start                 # http://localhost:3000
npm run dev               # with --watch
npm test                  # vitest (72 tests)
```

- **Production starts EMPTY**: only the admin bootstrap from `.env` is created (`AUTH_USER`/`AUTH_PASS`, bcrypt, idempotent).
- **Demo mode**: separate DB (`app_demo.db`) with a deterministic mockup seed (Mar/Jordi/demo, 4 projects, 6 labels, 15 tasks with dates relative to today, 3 tasks with description + attachments + comments + events). "Enter as demo" button → `POST /api/auth/demo` (no password). Disable with `PUT /api/settings/demo` (admin).
  - In the demo DB, `mar` (admin) and `jordi` (user) have password `deltos-demo`; `demo` has no usable password.
- Data in `DATA_DIR` (`app.db`, `app_demo.db`, `uploads/`). The compiled frontend is served from `STATIC_DIR` (`../app/dist`) with SPA fallback.

## Authentication

Cookie `session = id.hmac` (HMAC-SHA256), httpOnly, SameSite=Lax, 30 days, `Secure` flag configurable (`COOKIE_SECURE`, default false for dev http). Secret: `SESSION_SECRET` or auto-generated in `kv` (the cookie survives restarts). Session rotation after login. SQLite login rate-limit (`login_attempts`): 5 failures → 5 min lockout.

`GET /api/auth/me` returns `{ user, demo }` — `demo:true` if the session belongs to the demo DB (DEMO badge in the UI).

## Endpoints

### Auth (public: login, register, demo, logout, GET settings/demo)

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create user `{username, password≥6, color?, language?}` → 201 |
| POST | `/api/auth/login` | `{username, password}` → rotated cookie + `{user, demo:false}` · 401/429 |
| POST | `/api/auth/demo` | Passwordless demo session · **403** if disabled |
| POST | `/api/auth/logout` | Destroys session and clears cookie |
| GET | `/api/auth/me` | `{user, demo}` |
| PUT | `/api/auth/profile` | `{email?, phone?, language?, color?}` |
| PUT | `/api/auth/password` | `{current, next≥6}` — verifies the current one with bcrypt |

### Data (require session)

| Method | Path | Description |
|---|---|---|
| GET | `/api/bootstrap` | ONE call: `{users, projects (with per-column counts), labels, tasks}` — tasks with `labels[]`, `assignee`, `counts {comments, attachments}` |
| POST | `/api/projects` · PATCH/DELETE `/api/projects/:id` | Projects CRUD |
| POST | `/api/labels` · PATCH/DELETE `/api/labels/:id` | Labels CRUD (global) |
| POST | `/api/tasks` | `{project_id, title, description?, column?, priority?, due_date?, assignee_id?, labels?[]}` + `created` event |
| PATCH | `/api/tasks/:id` | title/description/priority/due_date/assignee_id/labels — each change its own `activity_event` |
| POST | `/api/tasks/:id/move` | `{column, position}` — reorders both columns in a transaction + `moved {from,to}` event |
| DELETE | `/api/tasks/:id` | Deletes (cascade) and compacts positions |
| GET | `/api/tasks/:id` | Detail: task + labels + attachments + comments + activity (LIMIT 50) |
| POST | `/api/tasks/:id/comments` | `{body}` — comments do NOT go to activity_events |
| POST | `/api/tasks/:id/attachments` | multipart `file`, ≤10 MB → `DATA_DIR/uploads/<uuid>` + `attachment` event |
| GET | `/api/attachments/:id` | Download with content-type and content-disposition |
| GET | `/api/activity?cursor=&limit=` | Global keyset feed (task, project, username) → `{items, nextCursor, hasMore}`, default 30, max 100 |
| GET | `/api/events` | SSE: `<domain>.changed` events with monotonic `id`, `Last-Event-ID` → `sync.resync`, `: ping` heartbeat 20 s · `X-Accel-Buffering: no` · max 20 clients (429) |
| GET | `/health` | `{status, uptime, memory, db}` |

### Admin

| Method | Path | Description |
|---|---|---|
| GET | `/api/users` | User list (no hashes) |
| POST | `/api/users` | `{username, password≥6, color?, role?}` |
| GET | `/api/settings/demo` | Public: `{demo_enabled}` (to show the demo button on login) |
| PUT | `/api/settings/demo` | `{enabled}` — production admin only |

## Technical notes

- **Two DBs**: `app.db` (production) and `app_demo.db` (demo). `requireAuth` resolves the session first in prod then in demo, and sets `c.get('db')` — all routes operate on the session's DB. Data never mixes.
- **WAL + hourly TRUNCATE checkpoint** + expired-session cleanup.
- **Headers**: CSP `default-src 'self'`, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; HSTS only if `COOKIE_SECURE=true`.
- **Graceful shutdown** (SIGTERM/SIGINT): notifies SSE clients, closes server and DB.
- **Logs**: NDJSON to stdout (own logger, `src/logger.js`), wide event per request (`src/wide-event.js`), level via `LOG_LEVEL` (default `info`). Operations: `../docs/logging.md`.
- **Reference runtime: Node 24 LTS** (Dockerfile `node:24-slim`, install.sh pins 24.18.1); `engines >=22` as floor.
- JSON in snake_case (same as the schema). **Errors: envelope `{error:{code,message,details?}}`** (catalogue in `src/error-codes.js`; full conventions in `../CONVENTIONS.md`).
- Board columns: `nuevo` | `encurso` | `hecho`. `position` global per column.
