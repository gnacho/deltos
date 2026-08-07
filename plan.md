# Plan — Deltos (PWA task manager for couples)

## Context
- User's own skill: Node 22 + Hono + better-sqlite3 (no ORM) + React 19 + Vite + Tailwind 3 + shadcn. Multi-user cookie HMAC auth, i18n ES+EN, demo mode, SSE, PWA. Fire rules in SKILL.md.
- Approved mockup: `/mnt/agents/output/taskdeck-mockup/index.html` (mobile-first, 3-state kanban, 4-tab detail, Todo/Projects/Activity/Settings views, desktop DnD, filters).
- Stack confirmed with the user: full Node, no Go hybrid.
- Real project at: `/mnt/agents/output/deltos/` (server/ + app/).

## Stages
1. **Backend** (coder): read `references/arquitectura.md`, `references/auth.md`, `references/seguridad.md`, `assets/schema.sql` from the skill. Build `server/`: SQLite schema (users, sessions, projects, labels, tasks, task_labels, attachments, comments, activity_events, kv), full auth + demo mode (separate DB), CRUD, move task (position), attachments, SSE with X-Accel-Buffering:no, SQLite rate-limit, security headers, zod env, graceful shutdown, WAL checkpoint, vitest. Seeds: Mar/Jordi + mockup dataset.
2. **Frontend** (coder): read `references/frontend.md`, `references/i18n.md`, `references/sistema-diseno.md`, `assets/DataProvider.template.tsx`, `assets/api-client.template.ts`, `assets/manifest.webmanifest`. Port the mockup to React 19 + Vite + TS + Tailwind: AuthGate + Login (with "Enter as demo"), synchronous DataProvider + single api-client + SSE, views per mockup, desktop DnD, i18n ES+EN, auto/light/dark theme, PWA manifest + icons.
3. **Integration + verification** (coder/verifier): build app, server serves dist/ with SPA fallback, Playwright E2E (login→logout required, create/move task, comment, SSE between two sessions), fixes, Dockerfile for preview, delivery via website_version_manager (dynamic).
4. **Delivery**: summary + demo credentials + next step (LXC deployment with infra skill).
