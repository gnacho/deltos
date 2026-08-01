# Deltos — server

Backend de **Deltos**, PWA de gestión de tareas para una pareja (multiusuario).
Node 22+ ESM · Hono 4 + @hono/node-server · better-sqlite3 (SQL directo, WAL) · bcryptjs · cookie · zod.

## Arranque

```bash
cp .env.example .env      # ajusta AUTH_USER / AUTH_PASS
npm install
npm start                 # http://localhost:3000
npm run dev               # con --watch
npm test                  # vitest (30 tests)
```

- **Producción arranca VACÍA**: solo se crea el admin bootstrap de `.env` (`AUTH_USER`/`AUTH_PASS`, bcrypt, idempotente).
- **Modo demo**: BD separada (`app_demo.db`) con seed determinista del mockup (Mar/Jordi/demo, 4 proyectos, 6 etiquetas, 15 tareas con fechas relativas a hoy, 3 tareas con descripción + adjuntos + comentarios + eventos). Botón "Entrar como demo" → `POST /api/auth/demo` (sin contraseña). Desactivable con `PUT /api/settings/demo` (admin).
  - En la BD demo, `mar` (admin) y `jordi` (user) tienen contraseña `deltos-demo`; `demo` no tiene contraseña usable.
- Datos en `DATA_DIR` (`app.db`, `app_demo.db`, `uploads/`). El frontend compilado se sirve desde `STATIC_DIR` (`../app/dist`) con SPA fallback.

## Autenticación

Cookie `session = id.hmac` (HMAC-SHA256), httpOnly, SameSite=Lax, 30 días, flag `Secure` configurable (`COOKIE_SECURE`, default false para dev http). Secret: `SESSION_SECRET` o autogenerado en `kv` (la cookie sobrevive reinicios). Rotación de sesión tras login. Rate-limit de login en SQLite (`login_attempts`): 5 fallos → bloqueo 5 min.

`GET /api/auth/me` devuelve `{ user, demo }` — `demo:true` si la sesión es de la BD demo (badge DEMO en la UI).

## Endpoints

### Auth (públicos: login, register, demo, logout, GET settings/demo)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | Alta de usuario `{username, password≥6, color?, language?}` → 201 |
| POST | `/api/auth/login` | `{username, password}` → cookie rotada + `{user, demo:false}` · 401/429 |
| POST | `/api/auth/demo` | Sesión demo sin contraseña · **403** si desactivado |
| POST | `/api/auth/logout` | Destruye sesión y limpia cookie |
| GET | `/api/auth/me` | `{user, demo}` |
| PUT | `/api/auth/profile` | `{email?, phone?, language?, color?}` |
| PUT | `/api/auth/password` | `{current, next≥6}` — verifica la actual con bcrypt |

### Datos (requieren sesión)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/bootstrap` | UNA llamada: `{users, projects (con counts por columna), labels, tasks}` — tasks con `labels[]`, `assignee`, `counts {comments, attachments}` |
| POST | `/api/projects` · PATCH/DELETE `/api/projects/:id` | CRUD proyectos |
| POST | `/api/labels` · PATCH/DELETE `/api/labels/:id` | CRUD etiquetas (globales) |
| POST | `/api/tasks` | `{project_id, title, description?, column?, priority?, due_date?, assignee_id?, labels?[]}` + evento `created` |
| PATCH | `/api/tasks/:id` | title/description/priority/due_date/assignee_id/labels — cada cambio su `activity_event` |
| POST | `/api/tasks/:id/move` | `{column, position}` — reordena ambas columnas en transacción + evento `moved {from,to}` |
| DELETE | `/api/tasks/:id` | Borra (cascada) y compacta posiciones |
| GET | `/api/tasks/:id` | Detalle: task + labels + attachments + comments + activity (LIMIT 50) |
| POST | `/api/tasks/:id/comments` | `{body}` — los comentarios NO van a activity_events |
| POST | `/api/tasks/:id/attachments` | multipart `file`, ≤10 MB → `DATA_DIR/uploads/<uuid>` + evento `attachment` |
| GET | `/api/attachments/:id` | Descarga con content-type y content-disposition |
| GET | `/api/activity?page=&limit=` | Feed global (task, proyecto, username), default 30, máx 100 |
| GET | `/api/events` | SSE: `hello`, heartbeat `ping` 25 s, `data: {"type":"changed","entity":...}` tras cada mutación · `X-Accel-Buffering: no` · máx 20 clientes (429) |
| GET | `/health` | `{status, uptime, memory, db}` |

### Admin

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/users` | Lista de usuarios (sin hashes) |
| POST | `/api/users` | `{username, password≥6, color?, role?}` |
| GET | `/api/settings/demo` | Público: `{demo_enabled}` (para mostrar el botón demo en login) |
| PUT | `/api/settings/demo` | `{enabled}` — solo admin de producción |

## Notas técnicas

- **Dos BD**: `app.db` (producción) y `app_demo.db` (demo). `requireAuth` resuelve la sesión primero en prod y luego en demo, y fija `c.get('db')` — todas las rutas operan sobre la BD de la sesión. Los datos nunca se mezclan.
- **WAL + checkpoint TRUNCATE cada hora** + limpieza de sesiones caducadas.
- **Headers**: CSP `default-src 'self'`, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; HSTS solo si `COOKIE_SECURE=true`.
- **Graceful shutdown** (SIGTERM/SIGINT): avisa a clientes SSE, cierra server y BD.
- JSON en snake_case (igual que el esquema). Errores `{error}` en español.
- Columnas del tablero: `nuevo` | `encurso` | `hecho`. `position` global por columna.
