# CONVENTIONS.md — Deltos API and logging conventions

Operational summary of the ADOPTED conventions (user skills `api-stack` and
`log-ops`). It is the contract for the frontend (phase 2) and for whoever
operates the service. In case of doubt, the code rules: `server/src/error-codes.js`,
`server/src/errors.js`, `server/src/logger.js`, `server/src/wide-event.js`,
`server/src/pagination.js`, `server/src/sse.js`.

## 1. API

### Error envelope (all 4xx/5xx)

```json
{ "error": { "code": "TASK_NOT_FOUND", "message": "Task not found", "details": { "...": "optional" } } }
```

- `code`: stable, machine-readable, `RESOURCE_STATE` convention. **The frontend
  translates by `code`** (source of truth, phase 2).
- `message`: Spanish, fallback only for logs and clients without i18n.
- `details`: optional. On 422 it carries the raw zod `{ issues: [...] }`
  (`path` + `code`) to retranslate field by field.
- Single construction in `app.onError` (`server/src/errors.js`): HTTPException
  (with domain `cause.code`) / ZodError → 422 / `SQLITE_CONSTRAINT_UNIQUE`
  → 409 / else → 500. **The 500 never leaks stack or internals to the client**
  (it does to the log, at `error` level).
- Every response carries the `x-request-id` header (correlation with logs).

### Code catalogue (`server/src/error-codes.js`)

| Code | HTTP | Usage |
|---|---|---|
| `BAD_REQUEST` | 400 | Generic bad request |
| `VALIDATION_FAILED` | 422 | zValidator failed; `details.issues` |
| `INVALID_CURSOR` | 400 | Malformed keyset cursor |
| `NOT_FOUND` | 404 | Generic missing route/resource |
| `PAYLOAD_TOO_LARGE` | 413 | Content-Length exceeds the limit |
| `UNIQUE_VIOLATION` | 409 | UNIQUE safety net without a domain code |
| `RATE_LIMITED` | 429 | Generic rate limit |
| `INTERNAL_ERROR` | 500 | Server bug (no stack to the client) |
| `AUTH_REQUIRED` | 401 | No valid session |
| `AUTH_INVALID_CREDENTIALS` | 401 | Failed login |
| `AUTH_RATE_LIMITED` | 429 | Login locked 5 min after 5 failures |
| `AUTH_FORBIDDEN` | 403 | Admin role required |
| `AUTH_WRONG_CURRENT_PASSWORD` | 400 | Password change: current one wrong |
| `AUTH_DEMO_DISABLED` | 403 | Demo mode disabled in Settings |
| `CSRF_INVALID` | 403 | CSRF token missing or mismatch |
| `DEMO_UNAVAILABLE` | 503 | Demo DB without demo user |
| `USER_NOT_FOUND` | 404 | |
| `USER_ALREADY_EXISTS` | 409 | username UNIQUE |
| `USER_LAST_ADMIN` | 400 | At least 1 admin must remain |
| `USER_SELF_ROLE` | 400 | You cannot change your own role |
| `USER_SELF_DELETE` | 400 | You cannot delete yourself |
| `PROJECT_NOT_FOUND` | 404 | |
| `LABEL_NOT_FOUND` | 404 | |
| `LABEL_NAME_TAKEN` | 409 | labels.name UNIQUE (create and rename) |
| `TASK_NOT_FOUND` | 404 | |
| `ASSIGNEE_NOT_FOUND` | 404 | |
| `ATTACHMENT_NOT_FOUND` | 404 | |
| `ATTACHMENT_FILE_MISSING` | 404 | File not on disk |
| `UPLOAD_FILE_REQUIRED` | 400 | Missing `file` field in multipart |
| `UPLOAD_TOO_LARGE` | 413 | File > `MAX_UPLOAD_MB` |
| `UPLOAD_INVALID_MIME` | 415 | MIME type not allowed |
| `SETTINGS_PROD_ONLY` | 403 | Setting only from a production session |
| `SSE_TOO_MANY_CLIENTS` | 429 | SSE hub full (`MAX_SSE_CLIENTS`) |
| `PUSH_NOT_CONFIGURED` | 503 | No VAPID keys |
| `PUSH_DEMO_UNAVAILABLE` | 501 | No real push in demo mode |

### Validation

`zValidator` from `@hono/zod-validator` on **every** route (`json` / `query` /
`param` as appropriate) with a hook that throws the `ZodError` → 422 with the
envelope. Multipart (attachments) validates presence, size and the **MIME
whitelist** by hand (it is not JSON). Allowed types: images (jpeg/png/gif/webp/svg+xml),
PDF, text (plain/csv), JSON, Office/ODF documents, and compressed archives
(zip/gzip/tar). Any other MIME → 415 `UPLOAD_INVALID_MIME`.

### CSRF (per-session token)

Every authenticated mutation (POST/PUT/PATCH/DELETE on `/api/*`) requires the
`x-csrf-token` header with the session token. The token is obtained in the
body of `POST /api/auth/login`, `POST /api/auth/demo` and
`GET /api/auth/me` (`csrfToken` field). GET/HEAD/OPTIONS are exempt.
Public routes without a session (login/demo/logout) are also exempt.
Missing or mismatched token → **403 `CSRF_INVALID`**.

### Status codes on mutations

- `POST` that creates → **201 + `Location` header** (`/api/tasks/:id`,
  `/api/projects/:id`, `/api/labels/:id`, `/api/users/:id`,
  `/api/attachments/:id`; for comments it points to the containing task
  because there is no GET for a single comment).
- `DELETE` → **204 without body** (`/api/tasks/:id`, `/api/projects/:id`,
  `/api/labels/:id`, `/api/users/:id`, `/api/push/unsubscribe`).
- SQLite UNIQUE violation → **409 with a domain code**.

### Keyset pagination — `GET /api/activity`

- Query: `?cursor=<opaque>&limit=<1..100>` (default 30). No `page`/`offset`.
- Opaque base64url cursor of `{ts, id}` (ts = `created_at` epoch ms; id =
  tiebreaker). LIMIT n+1 → response `{ items, nextCursor, hasMore }`.
- `nextCursor: null` and `hasMore: false` on the last page.
- Malformed cursor → **400 `INVALID_CURSOR`** (never ignored: it would silently
  return page 1 and the UI would see duplicates).
- **CONTRACT CHANGE** vs ≤1.4.0: before `{items, page, limit, total}`
  with `?page=&limit=`. The phase-2 frontend must migrate to the cursor.

### SSE — `GET /api/events`

- **Named** events `<domain>.changed`: `task.changed`, `project.changed`,
  `label.changed`, `comment.changed`, `attachment.changed`, `user.changed`,
  `settings.changed`. Client: `source.addEventListener('task.changed', …)`.
- `id:` **monotonic** strictly increasing on every event (including `hello`
  and `sync.resync`).
- `Last-Event-ID`: on reconnect, if the seen id is older than the current
  sequence, the server emits **ONE `sync.resync`** (`data: {type:'changed',
  entity:'*'}`) = "refetch everything via REST". Events are change
  notifications without data, not a data channel: there is no history to replay.
- Heartbeat: SSE comment **`: ping` every 20 s** (critical behind Nginx Proxy
  Manager; not an event, does not move `lastEventId`).
- `data` still is `{type:'changed', entity}` (compatibility with the current
  frontend until phase 2).
- **CONTRACT CHANGES** vs ≤1.4.0: before unnamed events (`message` channel),
  no `id`, and heartbeat as a `ping` event. Phase 2 must move from `onmessage`
  to `addEventListener('<domain>.changed')` + `sync.resync`.
- `shutdown` notifies on graceful close; `X-Accel-Buffering: no`; 429
  `SSE_TOO_MANY_CLIENTS` when the hub is full.

## 2. Logging (log-ops skill)

- **NDJSON to stdout → journald rotates, nobody else rotates.** No own files or
  in-app rotation. Full operations in `docs/logging.md`.
- Own dependency-free logger (`server/src/logger.js`): levels
  `debug`/`info`/`warn`/`error`, minimum via `LOG_LEVEL` (default `info`;
  `debug` only with a temporary systemd override).
- **Static messages + key-value attributes**: `msg` is the event name
  (snake_case, constant, searchable); data goes in attributes. Never
  interpolated strings with variable data in `msg`.
- **Wide events**: exactly 1 JSON event per API request
  (`msg: "http_request"`) with `request_id` (also the `x-request-id` header),
  `method`, `route` (template, not raw path → no query/PII), `status`,
  `duration_ms`, `user_id_hash`, `error.{code,message}` if there was an
  exception. `error` level only for 5xx/exceptions.
- **What is NOT logged** (anti-noise): `GET /health`, `GET /api/events` (SSE),
  GET/HEAD of static/SPA with status < 400, request/response bodies, SSE heartbeats.
- **PII: structured redaction by key** (not regex over the message) in ALL
  emitters: `password`, `token`, `secret`, `authorization`, `cookie`, `email`,
  `session`, `credentials`, … → `[REDACTED]` (full canonical list in
  `docs/logging.md`; any key containing `token`/`secret`/`password` is also
  censored). Never full emails or full IPs. `user_id` is always
  `user_id_hash` = `u_` + SHA-256(12 hex). Stack traces only with `LOG_LEVEL=debug`.
- **Deploy**: `deploy/journald-deltos.conf` (unit drop-in with
  `LogRateLimit*`); global journald drop-in and queries in `docs/logging.md`;
  logrotate only for third-party files (NPM).

## 3. Runtime and versions

- **Node 24 LTS is the reference runtime** (Dockerfile `node:24-slim`,
  `install.sh` pins `NODE_VERSION="24.18.1"`). `engines: ">=22"` as floor to
  avoid breaking outdated environments; CI/tests run on 24.
- Suite: vitest 4.1.10, 72 tests (`npm test` in `server/`).

## 4. Decided but pending (major rework, deferred)

Skill decisions **not adopted yet** for pragmatism (they would break the
current auth/frontend; they need a dedicated phase):

1. **Migration to `/api/v1`** (versioned resource layout). Today the routes
   hang off `/api/*` unversioned. Pending: move to `/api/v1/<resource>`
   keeping `/api/health` outside the versioning, with a compatibility period.
2. **Typed contract with the frontend**: `shared/schemas.ts` (shared zod),
   `export type AppType` and `hc<AppType>()` client in React, with
   `ApplyGlobalResponse` to type the global envelopes. Requires routes defined
   as chained sub-apps with inline handlers (today it is plain JS with
   `registerXRoutes(app)`), likely a server migration to TS.
3. **`Idempotency-Key`** on sensitive POSTs (table `idempotency_keys`, TTL 24
   h): not implemented; current mutations are low-risk and the header stays
   reserved in the contract.
4. **Server-side i18n of `message`** (locale = session > `Accept-Language`):
   today the fallback is always Spanish; phase 2 will translate by `code`.

The UI conventions section will be added by the phase-2 frontend.

## 5. UI (ui-appearance-system skill, adapted to Tailwind)

Appearance conventions adopted in `app/` (phase 2). The original skill
prescribes "all color via CSS variables"; **documented adaptation decision**:
Deltos already uses Tailwind with its own tokens (`--canvas-rgb`,
`--surface-rgb`, `--ok-rgb`, … mapped in `tailwind.config.js`), so CSS
variables are used **only for the accent** (`--accent-rgb`,
`--accent-soft-rgb`, `--accent-fg-rgb`) and the rest of the system stays on
the existing Tailwind tokens. There is no full migration to variables.

- **Accent**: 4 options (`emerald` by default, `sky`, `violet`, `amber`),
  each with a DISTINCT `[color, soft]` pair per theme. The `color` has
  ≥4.5:1 contrast over `--surface` in both themes (used as active text in
  tabs, bottom-nav and links); the `soft` is the subtle selection/badge
  background; `--accent-fg-rgb` is the ink on the accent (white in light,
  dark in dark). Single source: `src/theme/accents.ts` (the `ACCENTS` table);
  consumed via the Tailwind classes `bg-brand`, `text-brand`, `bg-brand-soft`,
  `text-brandfg`, `border-brand`.
- **Accent-independent semantics**: `--ok/--warn/--danger/--info` (classes
  `text-ok`, `bg-ok`, …) NEVER follow the accent. With an amber accent, a
  healthy state (`ok`) and a warning (`warn`) must stay distinguishable.
- **Triple theme** `light|dark|auto` (`.dark` class on `<html>`, watcher of
  `prefers-color-scheme` in auto) and **density** `comfortable|compact`:
  compact = `html{font-size:13.5px}` + `data-density="compact"` with targeted
  CSS rules in `index.css` (card/list paddings and gaps). Everything is sized
  in rem/em scaling only with the font-size lever; when writing new CSS, use
  rem/em (never `zoom`).
- **Prepaint mirror**: the inline script in `index.html` applies theme, accent
  and density from localStorage BEFORE the first paint (no flash). It is a
  MIRROR of `accents.ts`/`ThemeProvider.tsx` (same keys `deltos-theme`,
  `deltos-accent`, `deltos-density`, same accent table): if one part changes,
  change the other. The `<meta>` `theme-color` stays in sync with the
  effective theme.
- **i18n**: flat ES/EN dictionaries (`src/i18n/locales/*/translation.json`)
  with react-i18next; auto = `navigator.language`, override per user profile.
  Never literals in JSX. **API errors by code**: the `errors` namespace covers
  the whole §1 catalogue; the UI resolves `errors.<code>`
  (`src/lib/errors.ts#apiErrorText`) and falls back to the server `message`
  when the key is missing. 422 `VALIDATION_FAILED` exposes
  `details.issues` to mark fields (`fieldErrors`).
- **Visible focus** global: `:focus-visible { outline: 2px solid
  rgb(var(--accent-rgb)) }`; do not remove. No flashy animations
  (color/background transitions ≤ .45s) and `prefers-reduced-motion` respected
  (media query + Settings switch).
- **Accessible modals**: overlay closes on outside click, `Escape` closes,
  focus trapped, `role="dialog"`. **iOS safe-area**
  (`env(safe-area-inset-bottom)`) in the bottom-nav.
- **Mandatory visual verification** of any appearance change:
  2 themes × 4 accents × 2 densities × 2 languages on the touched view (minimum
  reasonable: both themes + one non-emerald accent + compact), with screenshots.
