# Deltos

> [English version](README.md)

PWA de gestión de tareas para pareja: tablero kanban compartido (Nuevo / En curso / Hecho)
con sincronización en vivo entre sesiones (SSE), comentarios, adjuntos, feed de actividad,
filtros, modo claro/oscuro, i18n (es/en) e instalable como app.

- **Backend** (`server/`): Node 22 + Hono + better-sqlite3 (WAL). Sirve la API, los
  estáticos del frontend y el stream SSE en el mismo puerto (sin CORS).
- **Frontend** (`app/`): React 19 + Vite + Tailwind, compilado a `app/dist/`.

## Instalación (servidor Linux, un comando)

```bash
curl -fsSL https://raw.githubusercontent.com/gnacho/deltos/main/install.sh | sh
```

Detecta distro/arquitectura (amd64, arm64), descarga la release verificada
(sha256 contra `checksums.txt`), instala un runtime Node versionado y la app en
`/opt/deltos`, crea un servicio systemd sandboxed `deltos` y muestra la contraseña
admin inicial. Requiere systemd. Actualizar = re-ejecutar el mismo comando;
desinstalar con `sh install.sh --uninstall`. Si prefieres inspeccionar antes:
`curl -fsSL …/install.sh -o install.sh && less install.sh`.

Las releases se publican por tag `v*` con `node_modules` pre-compilado por
arquitectura (`.github/workflows/release.yml`) — no hace falta compilador en
el servidor.

## Desarrollo

Requisito: Node ≥ 22.

```bash
# Backend (puerto 3000 por defecto; ver server/.env.example)
cd server
npm ci
cp .env.example .env   # ajusta AUTH_USER / AUTH_PASS
npm run dev            # o npm start

# Frontend (otro terminal, con proxy al backend en dev)
cd app
npm ci
npm run dev

# Build de producción del frontend (lo sirve el propio backend)
npm run build
```

Con `npm run build` hecho, basta el backend: sirve la SPA desde `app/dist` con fallback SPA.

## Credenciales

- **Producción**: el primer arranque crea el admin con `AUTH_USER` / `AUTH_PASS`
  (idempotente; si `AUTH_PASS` falta **no** se crea admin y se registra un aviso).
  En el `.env.example`: `admin` / `cambia-esta-password`.
- **Demo**: botón «Entrar como demo» en el login (sin contraseña). BD demo separada
  (`app_demo.db`), sembrada con 3 usuarios, 4 proyectos, 6 etiquetas y 15 tareas.
  Se puede desactivar en Ajustes (solo admin).

## Tests

```bash
cd server && npm test          # vitest: 30 tests de API/auth/adjuntos
```

## Docker

```bash
docker build -t deltos .
docker run -d --name deltos -p 3000:3000 \
  -e AUTH_USER=admin -e AUTH_PASS='pon-una-password-segura' \
  -v deltos-data:/app/data \
  deltos
```

- Imagen `node:22-slim` multi-etapa: `npm ci --omit=dev` del server + `server/` + `app/dist/`.
- Variables (ver `server/src/config.js`): `PORT` (3000), `DATA_DIR` (`/app/data`),
  `STATIC_DIR` (`/app/app/dist`), `AUTH_USER`/`AUTH_PASS` (defaults del Dockerfile:
  `admin` / `cambiar-1234` — **cámbialos**), `COOKIE_SECURE` (`true` solo tras HTTPS),
  `SESSION_SECRET` (opcional; si falta se autogenera y persiste en la BD),
  `MAX_SSE_CLIENTS` (20), `MAX_UPLOAD_MB` (10).
- El `.env` **no** se copia a la imagen: todo viene de defaults + entorno del contenedor.
- Persistencia: monta un volumen en `/app/data` (SQLite + uploads).

## Despliegue (systemd)

Para despliegue en VPS con systemd + reverse proxy (Caddy/nginx con TLS y
`COOKIE_SECURE=true`), remite al skill **infraestructura**. Unidad mínima de ejemplo:

```ini
[Unit]
Description=Deltos
After=network.target

[Service]
WorkingDirectory=/opt/deltos/server
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/deltos
Environment=AUTH_USER=admin
Environment=AUTH_PASS=cambia-esto
ExecStart=/usr/bin/node src/index.js
Restart=always
User=deltos

[Install]
WantedBy=multi-user.target
```

## E2E

Verificación E2E con Playwright (login/logout, SSE entre dos sesiones, flujo completo de
tareas con DnD y adjuntos, ajustes, capturas móvil/desktop en claro y oscuro):
7/7 tests en verde, 0 errores de consola inesperados. Capturas en `e2e-screenshots/`.

## Licencia

[AGPL-3.0](LICENSE)
