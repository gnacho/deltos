# CONVENTIONS.md — convenciones de API y logging de Deltos

Resumen operativo de las convenciones ADOPTADAS (skills de usuario `api-stack`
y `log-ops`). Es el contrato para el frontend (fase 2) y para quien opere el
servicio. En caso de duda, el código manda: `server/src/error-codes.js`,
`server/src/errors.js`, `server/src/logger.js`, `server/src/wide-event.js`,
`server/src/pagination.js`, `server/src/sse.js`.

## 1. API

### Envelope de errores (TODO 4xx/5xx)

```json
{ "error": { "code": "TASK_NOT_FOUND", "message": "Tarea no encontrada", "details": { "...": "opcional" } } }
```

- `code`: estable, machine-readable, convención `RECURSO_ESTADO`. **El frontend
  traduce por `code`** (fuente de verdad, fase 2).
- `message`: español, solo fallback para logs y clientes sin i18n.
- `details`: opcional. En 422 lleva `{ issues: [...] }` crudos de zod
  (`path` + `code`) para re-traducir campo a campo.
- Construcción única en `app.onError` (`server/src/errors.js`): HTTPException
  (con `cause.code` de dominio) / ZodError → 422 / `SQLITE_CONSTRAINT_UNIQUE`
  → 409 / resto → 500. **El 500 nunca filtra stack ni internals al cliente**
  (sí al log, nivel `error`).
- Toda respuesta lleva cabecera `x-request-id` (correlación con logs).

### Catálogo de códigos (`server/src/error-codes.js`)

| Code | HTTP | Uso |
|---|---|---|
| `BAD_REQUEST` | 400 | Petición incorrecta genérica |
| `VALIDATION_FAILED` | 422 | zValidator falló; `details.issues` |
| `INVALID_CURSOR` | 400 | Cursor keyset malformado |
| `NOT_FOUND` | 404 | Ruta/recurso genérico inexistente |
| `PAYLOAD_TOO_LARGE` | 413 | Content-Length excede el límite |
| `UNIQUE_VIOLATION` | 409 | Red de seguridad UNIQUE sin código de dominio |
| `RATE_LIMITED` | 429 | Rate-limit genérico |
| `INTERNAL_ERROR` | 500 | Bug del server (sin stack al cliente) |
| `AUTH_REQUIRED` | 401 | Sin sesión válida |
| `AUTH_INVALID_CREDENTIALS` | 401 | Login fallido |
| `AUTH_RATE_LIMITED` | 429 | Login bloqueado 5 min tras 5 fallos |
| `AUTH_FORBIDDEN` | 403 | Requiere rol admin |
| `AUTH_WRONG_CURRENT_PASSWORD` | 400 | Cambio de contraseña: actual incorrecta |
| `AUTH_DEMO_DISABLED` | 403 | Modo demo desactivado en Ajustes |
| `DEMO_UNAVAILABLE` | 503 | BD demo sin usuario demo |
| `USER_NOT_FOUND` | 404 | |
| `USER_ALREADY_EXISTS` | 409 | username UNIQUE |
| `USER_LAST_ADMIN` | 400 | Debe quedar ≥ 1 admin |
| `USER_SELF_ROLE` | 400 | No puedes cambiar tu propio rol |
| `USER_SELF_DELETE` | 400 | No puedes eliminarte a ti mismo |
| `PROJECT_NOT_FOUND` | 404 | |
| `LABEL_NOT_FOUND` | 404 | |
| `LABEL_NAME_TAKEN` | 409 | labels.name UNIQUE (alta y renombrado) |
| `TASK_NOT_FOUND` | 404 | |
| `ASSIGNEE_NOT_FOUND` | 404 | |
| `ATTACHMENT_NOT_FOUND` | 404 | |
| `ATTACHMENT_FILE_MISSING` | 404 | Fichero no está en disco |
| `UPLOAD_FILE_REQUIRED` | 400 | Falta campo `file` en multipart |
| `UPLOAD_TOO_LARGE` | 413 | Fichero > `MAX_UPLOAD_MB` |
| `SETTINGS_PROD_ONLY` | 403 | Ajuste solo desde sesión de producción |
| `SSE_TOO_MANY_CLIENTS` | 429 | Hub SSE lleno (`MAX_SSE_CLIENTS`) |
| `PUSH_NOT_CONFIGURED` | 503 | Sin claves VAPID |
| `PUSH_DEMO_UNAVAILABLE` | 501 | Sin push real en modo demo |

### Validación

`zValidator` de `@hono/zod-validator` en **cada** ruta (`json` / `query` /
`param` según corresponda) con hook que lanza el `ZodError` → 422 con
envelope. Multipart (adjuntos) valida presencia/tamaño a mano (no es JSON).

### Códigos de estado en mutaciones

- `POST` que crea → **201 + cabecera `Location`** (`/api/tasks/:id`,
  `/api/projects/:id`, `/api/labels/:id`, `/api/users/:id`,
  `/api/attachments/:id`; en comentarios apunta a la tarea contenedora porque
  no hay GET de comentario individual).
- `DELETE` → **204 sin cuerpo** (`/api/tasks/:id`, `/api/projects/:id`,
  `/api/labels/:id`, `/api/users/:id`, `/api/push/unsubscribe`).
- Violación UNIQUE de SQLite → **409 con código de dominio**.

### Paginación keyset — `GET /api/activity`

- Query: `?cursor=<opaco>&limit=<1..100>` (default 30). Sin `page`/`offset`.
- Cursor opaco base64url de `{ts, id}` (ts = `created_at` epoch ms; id =
  desempate). LIMIT n+1 → respuesta `{ items, nextCursor, hasMore }`.
- `nextCursor: null` y `hasMore: false` en la última página.
- Cursor malformado → **400 `INVALID_CURSOR`** (nunca se ignora: devolvería la
  página 1 en silencio y la UI vería duplicados).
- **CAMBIO de contrato** respecto a ≤1.4.0: antes `{items, page, limit, total}`
  con `?page=&limit=`. La fase 2 del frontend debe migrar a cursor.

### SSE — `GET /api/events`

- Eventos **nombrados** `<dominio>.changed`: `task.changed`, `project.changed`,
  `label.changed`, `comment.changed`, `attachment.changed`, `user.changed`,
  `settings.changed`. El cliente: `source.addEventListener('task.changed', …)`.
- `id:` **monótono** estrictamente creciente en todos los eventos (incluidos
  `hello` y `sync.resync`).
- `Last-Event-ID`: al reconectar, si el id visto es anterior a la secuencia
  actual, el server emite **UN `sync.resync`** (`data: {type:'changed',
  entity:'*'}`) = "refetchea todo vía REST". Los eventos son notificaciones de
  cambio sin datos, no canal de datos: no hay histórico que reenviar.
- Heartbeat: comentario SSE **`: ping` cada 20 s** (crítico tras Nginx Proxy
  Manager; no es un evento, no mueve `lastEventId`).
- `data` sigue siendo `{type:'changed', entity}` (compatibilidad con el
  frontend actual hasta la fase 2).
- **CAMBIOS de contrato** respecto a ≤1.4.0: antes eventos sin nombre (canal
  `message`), sin `id` y heartbeat como evento `ping`. La fase 2 debe pasar de
  `onmessage` a `addEventListener('<dominio>.changed')` + `sync.resync`.
- `shutdown` avisa en cierre graceful; `X-Accel-Buffering: no`; 429
  `SSE_TOO_MANY_CLIENTS` con el hub lleno.

## 2. Logging (skill log-ops)

- **NDJSON a stdout → journald rota, nadie más rota.** Sin ficheros propios ni
  rotación in-app. Operación completa en `docs/logging.md`.
- Logger propio sin dependencias (`server/src/logger.js`): niveles
  `debug`/`info`/`warn`/`error`, mínimo por `LOG_LEVEL` (default `info`;
  `debug` solo con override temporal de systemd).
- **Mensajes estáticos + atributos clave-valor**: `msg` es el nombre del
  evento (snake_case, constante, buscable); los datos van en atributos. Nunca
  strings interpolados con datos variables en `msg`.
- **Wide events**: exactamente 1 evento JSON por request API
  (`msg: "http_request"`) con `request_id` (también cabecera `x-request-id`),
  `method`, `route` (plantilla, no path cruda → sin query/PII), `status`,
  `duration_ms`, `user_id_hash`, `error.{code,message}` si hubo excepción.
  Nivel `error` solo si 5xx/excepción.
- **Qué NO se loguea** (anti-ruido): `GET /health`, `GET /api/events` (SSE),
  GET/HEAD de estáticos/SPA con status < 400, bodies de request/response,
  heartbeats SSE.
- **PII: redacción estructurada por clave** (no regex sobre el mensaje) en
  TODOS los emisores: `password`, `token`, `secret`, `authorization`,
  `cookie`, `email`, `session`, `credentials`, … → `[REDACTADO]` (lista
  canónica completa en `docs/logging.md`; cualquier clave que contenga
  `token`/`secret`/`password` también se censura). Nunca emails completos ni
  IPs completas. `user_id` siempre `user_id_hash` = `u_` + SHA-256(12 hex).
  Stack traces solo con `LOG_LEVEL=debug`.
- **Deploy**: `deploy/journald-deltos.conf` (drop-in de unidad con
  `LogRateLimit*`); drop-in global de journald y consultas en
  `docs/logging.md`; logrotate solo para ficheros ajenos (NPM).

## 3. Runtime y versiones

- **Node 24 LTS es el runtime de referencia** (Dockerfile `node:24-slim`,
  `install.sh` pin `NODE_VERSION="24.18.1"`). `engines: ">=22"` como suelo
  para no romper entornos atrasados; CI/tests corren con 24.
- Suite: vitest 4.1.10, 72 tests (`npm test` en `server/`).

## 4. Decidido y pendiente (rework mayor, pospuesto)

Decisiones de las skills **no adoptadas todavía** por pragmatismo (romperían
auth/frontend actuales; requieren fase dedicada):

1. **Migración a `/api/v1`** (layout versionado de recursos). Hoy las rutas
   cuelgan de `/api/*` sin versionar. Pendiente: mover a `/api/v1/<recurso>`
   manteniendo `/api/health` fuera del versionado, con periodo de compat.
2. **Contrato tipado con el frontend**: `shared/schemas.ts` (zod compartido),
   `export type AppType` y cliente `hc<AppType>()` en React, con
   `ApplyGlobalResponse` para tipar los envelopes globales. Requiere que las
   rutas se definan como sub-apps encadenadas con handlers inline (hoy es JS
   plano con `registerXRoutes(app)`), probablemente migración del server a TS.
3. **`Idempotency-Key`** en POSTs sensibles (tabla `idempotency_keys`, TTL 24
   h): no implementado; las mutaciones actuales son de bajo riesgo y el header
   queda reservado en el contrato.
4. **i18n server-side de `message`** (locale = sesión > `Accept-Language`):
   hoy el fallback es siempre español; la fase 2 traducirá por `code`.

La sección de convenciones de UI la añadirá la fase 2 del frontend.

## 5. UI (skill ui-appearance-system, adaptada a Tailwind)

Convenciones de apariencia adoptadas en `app/` (fase 2). La skill original
prescribe "todo el color por variables CSS"; **decisión documentada de
adaptación**: Deltos ya usa Tailwind con tokens propios (`--canvas-rgb`,
`--surface-rgb`, `--ok-rgb`, … mapeados en `tailwind.config.js`), así que las
variables CSS se usan **solo para el acento** (`--accent-rgb`,
`--accent-soft-rgb`, `--accent-fg-rgb`) y el resto del sistema sigue en los
tokens Tailwind existentes. No hay migración completa a variables.

- **Acento**: 4 opciones (`emerald` por defecto, `sky`, `violet`, `amber`),
  cada una con par `[color, soft]` DISTINTO por tema. El `color` tiene
  contraste ≥4.5:1 sobre `--surface` en ambos temas (se usa como texto activo
  en pestañas, bottom-nav y enlaces); el `soft` es fondo sutil de
  selección/badges; `--accent-fg-rgb` es la tinta sobre el acento (blanco en
  claro, oscuro en oscuro). Fuente única: `src/theme/accents.ts` (tabla
  `ACCENTS`); se consume vía clases Tailwind `bg-brand`, `text-brand`,
  `bg-brand-soft`, `text-brandfg`, `border-brand`.
- **Semántica independiente del acento**: `--ok/--warn/--danger/--info`
  (clases `text-ok`, `bg-ok`, …) NUNCA siguen al acento. Con acento ámbar, un
  estado sano (`ok`) y un aviso (`warn`) deben seguir siendo distinguibles.
- **Tema triple** `light|dark|auto` (clase `.dark` en `<html>`, watcher de
  `prefers-color-scheme` en auto) y **densidad** `comfortable|compact`:
  compact = `html{font-size:13.5px}` + `data-density="compact"` con reglas
  CSS puntuales en `index.css` (paddings/gaps de tarjetas y listas). Todo lo
  dimensionado en rem/em escala solo con la palanca de font-size; al crear
  CSS nuevo, usar rem/em (nunca `zoom`).
- **Prepaint espejo**: el script inline de `index.html` aplica tema, acento y
  densidad desde localStorage ANTES del primer paint (sin flash). Es ESPEJO
  de `accents.ts`/`ThemeProvider.tsx` (mismas claves `deltos-theme`,
  `deltos-accent`, `deltos-density`, misma tabla de acentos): si cambia una
  parte, cambiar la otra. `theme-color` del `<meta>` se sincroniza con el
  tema efectivo.
- **i18n**: diccionarios planos ES/EN (`src/i18n/locales/*/translation.json`)
  con react-i18next; auto = `navigator.language`, override por perfil de
  usuario. Nunca literales en JSX. **Errores de API por código**: el
  namespace `errors` cubre TODO el catálogo de §1; la UI resuelve
  `errors.<code>` (`src/lib/errors.ts#apiErrorText`) y cae al `message` del
  server si falta la clave. 422 `VALIDATION_FAILED` expone
  `details.issues` para marcar campos (`fieldErrors`).
- **Foco visible** global: `:focus-visible { outline: 2px solid
  rgb(var(--accent-rgb)) }`; no quitar. Sin animaciones vistosas
  (transiciones de color/fondo ≤ .45s) y `prefers-reduced-motion` respetado
  (media query + switch de Ajustes).
- **Modales accesibles**: overlay cierra al click fuera, `Escape` cierra,
  foco atrapado, `role="dialog"`. **Safe-area iOS**
  (`env(safe-area-inset-bottom)`) en bottom-nav.
- **Verificación visual obligatoria** de cualquier cambio de apariencia:
  2 temas × 4 acentos × 2 densidades × 2 idiomas en la vista tocada (mínimo
  razonable: ambos temas + un acento no-emerald + compacta), con capturas.
