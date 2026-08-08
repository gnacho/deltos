# Changelog

All notable changes to Deltos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Todo

- **Security and robustness audit** (bug-hunting release): review auth and
  sessions, CSRF token, HTTP security headers, path traversal,
  secrets (SESSION_SECRET outside the DB), rate limits and body caps, and
  latent bugs. Each finding becomes its own issue/PR.

## [2.3.3] - 2026-08-08

### Fixed

- **In-app "Update now" works again.** The apply used to run the update script
  from inside the sandboxed service, which cannot write /opt/deltos or restart,
  so it failed with 500. It now writes a flag file in the data directory; a
  systemd `.path` unit watches it and starts the root update service on demand.
  The apply is asynchronous: the page polls the server version until it changes.

### Thanks

- To **Carlos Nebot**, whose feedback on the installer and demo shaped this
  whole 2.3 line: the dry-run honesty, the read-only demo behind a login
  button, and the long list of update-flow bugs that turned out to be hiding
  behind "Update now".

## [2.3.2] - 2026-08-08

### Fixed

- **Update script no longer deletes .env on the flat layout.** The flat-layout
  branch replaced the whole `server/` directory, wiping the local `.env`
  (DATA_DIR, PORT, VAPID) and crash-looping the service after an update. It now
  replaces only the code (src, node_modules, package.json) and leaves `.env`
  and other local files untouched.

## [2.3.1] - 2026-08-08

### Fixed

- **In-app update apply flow** (three bugs that prevented "Update now" from
  ever succeeding): the update script aborted on the flat layout because `$TS`
  was used but never assigned under `set -eu`; the checksums.txt download hit a
  stale CDN cache right after a release shipped (now fetched with a
  cache-buster); and the installer wrote `Restart=on-failure`, which does not
  restart on the apply's clean `process.exit(0)` (now `Restart=always`).

## [2.3.0] - 2026-08-08

### Changed

- **Demo is now a read-only database behind a login button.** Previously demo
  was a global toggle in the production database (defaulting on) with a fully
  writable demo database; after an update a user could land on the demo data
  and think their own was gone. Now every mutation on a demo session is
  rejected with `403 DEMO_READ_ONLY`, browsing and logout still work, and the
  admin toggle only controls whether the demo button is visible on the login
  screen (no persistent state that can be left on by mistake).

### Fixed

- **Installer `--dry-run` now tells the truth about timers.** It used to
  announce the weekly update timer even when the installed release did not
  ship it. The dry-run and the real install now agree, by gating each timer on
  whether its script is bundled in the release tarball. The weekly update
  timer scripts now ship in the release too.

## [2.2.0] - 2026-08-07

### Added

- **Icon picker for projects**: when creating or editing a project, instead of
  typing an emoji you pick from a curated catalogue of **63 Lucide icons**
  (home, household chores, garden, transport, office, everyday objects, food,
  family/leisure and tech). Icons are monochrome and follow the light/dark
  theme.
- **Compact picker**: the icon is a button next to the name; clicking it opens
  the selection, and choosing one closes it leaving the picked icon in place.
- **Monochrome icons in the board selector** in the top bar and in the project
  selector when creating a task (replacing native `<select>` elements, which
  could only show colored emojis).

### Changed

- Existing projects with an emoji (e.g. 🏡) migrate to their equivalent icon
  (`home`); any legacy emoji still renders as text (compatibility).

## [2.1.0] - 2026-08-07

### Added

- **Edit and delete projects from the Projects view**: every card has actions
  to edit (name, emoji, color with the prefilled inline form) and to delete,
  with confirmation.
- **Edit and delete projects from their board**: the header actions button
  opens the edit form directly and, at the bottom, offers deleting the project
  with confirmation.

### Changed

- **Shared project form** (`ProjectForm`): the Projects view and the board use
  the same create/edit component, with the same fields and validation.
- **Board actions button**: from a dropdown menu to direct editing, with a
  sliders icon, placed to the right of the open-tasks counter.
- **Delete warning**: explains that the project's tasks, comments and
  attachments are removed too, and suggests moving tasks to another project
  first if you want to keep them. The confirm button is now pastel red with
  centered text.

### Thanks

- To **Carlos Nebot** for the feedback.

## [2.0.0] - 2026-08-06

### Changed

- **Build toolchain migration**: Vite 7 → 8 (Rolldown), @vitejs/plugin-react 4 → 6, Tailwind CSS 3 → 4 (CSS config via `@theme`, Vite plugin `@tailwindcss/vite`).
- **React Router 7 → 8.3.0**: imports migrated from `react-router-dom` to `react-router`.
- **Backend**: Hono 4.12 → 4.13, better-sqlite3 13.0.2 → 13.0.3, @hono/node-server 2.0.12 → 2.1.0, i18next 25 → 26 (frontend).

### Fixed

- **HIGH vulnerability (CSRF in RSC mode)**: GHSA-qwww-vcr4-c8h2, affecting react-router 7.12.0–8.2.0; fixed by react-router 8.3.0.
- **Real body cap on `/api/*`** (`hono/body-limit`): the previous check relied on `Content-Length` and could be bypassed with chunked bodies; both are now covered.
- **Minimum password length 10** in signup, user creation, password reset and password change (previously 6), aligned with the rest of the stack.

## [1.9.2] - 2026-08-01

### Added

- Horizontal AdminBar with update status (release check), demo, automatic backups with export and timer.
- About screen with real versions and uptime.

### Changed

- Settings cards reordered; AdminBar accent; simplified backups (3 days); users with active status.

## [1.9.1] - 2026-07-31

### Added

- Canonical "My profile" card with email icon, language, password, notifications and logout.
- Editable display name and working email in the profile.
- Subtle radial background from the accent; Appearance/Labels cards at 50/50 with equal height.

### Fixed

- Redirect to login on `CSRF_INVALID` so the app does not get stuck.

## [1.9.0] - 2026-07-30

### Added

- `PhotoCropDialog` to attach images with cropping.

## [1.8.0] - 2026-07-29

### Added

- Audit log.
- Rate limiting.
- Soft delete (trash).
- Data export.
- Session fingerprint.
- Mutation idempotency.

## [1.7.0] - 2026-07-28

### Added

- Server settings (backups + attachment limits).

### Fixed

- CSRF token, MIME whitelist, session invalidation on password change.

## [1.6.1] - 2026-07-27

### Fixed

- `PATCH` on labels/projects no longer resets fields with default values.

## [1.6.0] - 2026-07-27

### Added

- Label management.
- Canonical layout for Settings/Activity/Projects.
- Anti-black-screen protection on deployments.

## [1.5.0] - 2026-07-26

### Added

- API error envelope, JSON log-ops, Node 24 and accent picker.
- Interactive port dialog on fresh installs.
- Installer resource pre-flight (disk/memory/free port).

## [1.4.0] - 2026-07-25

### Added

- Web Push (VAPID) notifications for task activity.

## [1.3.0] - 2026-07-24

### Added

- Admin user management, update checker and offline PWA (webapp-shell gap).

## [1.2.0] - 2026-07-23

### Changed

- Project renamed from Nido to **Deltos**.

### Fixed

- `deltos_session` cookie and release tarball patterns renamed correctly.

## [1.0.0] - 2026-07-22

### Added

- One-liner installer and release pipeline (pre-built node_modules per architecture).
- Unified webapp shell (collapsible sidebar, rail, topbar, DemoBanner).
- Canonical tokens with compact density and reduce-motion.
- EN/ES README with AGPL-3.0 license.
- First stable public release of the Kanban PWA (formerly Nido).
