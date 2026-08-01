# Plan — Deltos (PWA gestor de tareas en pareja)

## Contexto
- Skill propio del usuario: Node 22 + Hono + better-sqlite3 (sin ORM) + React 19 + Vite + Tailwind 3 + shadcn. Auth multiusuario cookie HMAC, i18n ES+EN, modo demo, SSE, PWA. Reglas a fuego en SKILL.md.
- Mockup aprobado: `/mnt/agents/output/taskdeck-mockup/index.html` (mobile-first, kanban 3 estados, detalle 4 pestañas, vistas Todo/Proyectos/Actividad/Ajustes, DnD desktop, filtros).
- Stack confirmado con el usuario: Node completo, sin híbrido Go.
- Proyecto real en: `/mnt/agents/output/deltos/` (server/ + app/).

## Etapas
1. **Backend** (coder): leer `references/arquitectura.md`, `references/auth.md`, `references/seguridad.md`, `assets/schema.sql` del skill. Construir `server/`: schema SQLite (users, sessions, projects, labels, tasks, task_labels, attachments, comments, activity_events, kv), auth completa + modo demo (BD separada), CRUD, mover tarea (posición), adjuntos, SSE con X-Accel-Buffering:no, rate-limit SQLite, headers seguridad, zod env, graceful shutdown, WAL checkpoint, vitest. Seeds: Mar/Jordi + dataset del mockup.
2. **Frontend** (coder): leer `references/frontend.md`, `references/i18n.md`, `references/sistema-diseno.md`, `assets/DataProvider.template.tsx`, `assets/api-client.template.ts`, `assets/manifest.webmanifest`. Portar el mockup a React 19 + Vite + TS + Tailwind: AuthGate + Login (con "Entrar como demo"), DataProvider síncrono + api-client único + SSE, vistas según mockup, DnD desktop, i18n ES+EN, tema auto/claro/oscuro, PWA manifest + iconos.
3. **Integración + verificación** (coder/verifier): build app, server sirve dist/ con SPA fallback, Playwright E2E (login→logout obligatorio, crear/mover tarea, comentar, SSE entre dos sesiones), fixes, Dockerfile para preview, entrega vía website_version_manager (dynamic).
4. **Entrega**: resumen + credenciales demo + siguiente paso (despliegue LXC con skill infraestructura).
