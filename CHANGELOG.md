# Changelog

Todos los cambios notables de Deltos se documentan en este fichero.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/),
y este proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

### Todo

- **Auditoría de seguridad y robustez** (release bug-hunting): revisar auth y
  sesiones, CSRF token, cabeceras de seguridad HTTP, path traversal,
  secretos (SESSION_SECRET fuera de BD), rate-limit y body caps, y bugs
  latentes. Cada hallazgo se materializa en su propio issue/PR.

### Changed

- **Migración del toolchain de build**: Vite 7 → 8 (Rolldown), @vitejs/plugin-react 4 → 6, Tailwind CSS 3 → 4 (config en CSS vía `@theme`, plugin Vite `@tailwindcss/vite`).
- **React Router 7 → 8.3.0**: imports migrados de `react-router-dom` a `react-router`.
- **Backend**: Hono 4.12 → 4.13, better-sqlite3 13.0.2 → 13.0.3, @hono/node-server 2.0.12 → 2.1.0, i18next 25 → 26 (front).

### Fixed

- **Vulnerabilidad HIGH (CSRF en modo RSC)**: GHSA-qwww-vcr4-c8h2, afectaba a react-router 7.12.0–8.2.0; cerrada con react-router 8.3.0.
- **Body cap real en `/api/*`** (`hono/body-limit`): el check anterior dependía de `Content-Length` y se saltaba con bodies chunked; ahora también se cubren.
- **Password mínima 10 caracteres** en registro, alta de usuarios, reset y cambio de contraseña (antes 6), alineado con el resto de apps del stack.

## [1.9.2] - 2026-08-01

### Added

- AdminBar horizontal con estado de actualización (check de release), demo, respaldos auto con export y timer.
- Acerca de con versiones y uptime reales.

### Changed

- Reordenadas las tarjetas de Ajustes; acento en AdminBar; respaldos simplificado (3 días); usuarios con estado activo.

## [1.9.1] - 2026-07-31

### Added

- Tarjeta "Mi perfil" canónica con icono email, idioma, contraseña, notificaciones y logout.
- Nombre visible editable y email funcional en el perfil.
- Fondo radial sutil desde el acento; tarjetas de Apariencia/Etiquetas a 50/50 y misma altura.

### Fixed

- Redirigir a login ante `CSRF_INVALID` para no quedar atascado en la app.

## [1.9.0] - 2026-07-30

### Added

- `PhotoCropDialog` para adjuntar imágenes con recorte.

## [1.8.0] - 2026-07-29

### Added

- Audit log.
- Rate-limit.
- Soft-delete (papelera).
- Export de datos.
- Session fingerprint.
- Idempotencia de mutaciones.

## [1.7.0] - 2026-07-28

### Added

- Ajustes de servidor (respaldos + límites de adjuntos).

### Fixed

- CSRF token, whitelist de MIME, invalidación de sesión al cambiar la contraseña.

## [1.6.1] - 2026-07-27

### Fixed

- `PATCH` de etiquetas/proyectos ya no resetea los campos con valor por defecto.

## [1.6.0] - 2026-07-27

### Added

- Gestión de etiquetas.
- Layout canónico de Ajustes/Actividad/Proyectos.
- Protección anti pantalla-negra en despliegues.

## [1.5.0] - 2026-07-26

### Added

- Envelope de errores de API, JSON log-ops, Node 24 y selector de acento.
- Diálogo interactivo de puerto en instalación nueva.
- Pre-flight de recursos del instalador (disco/memoria/puerto libre).

## [1.4.0] - 2026-07-25

### Added

- Notificaciones push Web Push (VAPID) para la actividad de tareas.

## [1.3.0] - 2026-07-24

### Added

- Gestión de usuarios admin, comprobador de actualizaciones y PWA offline (gap de webapp-shell).

## [1.2.0] - 2026-07-23

### Changed

- Renombrado del proyecto de Nido a **Deltos**.

### Fixed

- Cookie `deltos_session` y patrones de tarball de release renombrados correctamente.

## [1.0.0] - 2026-07-22

### Added

- Instalador one-liner y pipeline de release (node_modules pre-built por arquitectura).
- Shell webapp unificado (sidebar colapsable, rail, topbar, DemoBanner).
- Tokens canónicos con densidad compacta y reduce-motion.
- README EN/ES con licencia AGPL-3.0.
- Primera versión pública estable del Kanban PWA (antes Nido).
