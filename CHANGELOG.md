# Changelog

All notable changes to Deltos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.6.24] - 2026-09-02

### Added

- **Task archiving (#200).** Done tasks older than 3 days are archived
  automatically (on boot and hourly, with SSE broadcast). Manual archive from
  the card, the mobile move sheet and the task detail; archived tasks are
  hidden from the board and revealed by a "Show archived" toggle under the
  Done column. Unarchiving grants a fresh 3-day window and moving an archived
  task reactivates it. Project counters ignore archived tasks.
- **Expense archiving (#203).** Same mechanics for paid expenses: 3-day
  auto-archive, manual archive (creator or payer), show-archived toggle under
  the Paid column. Money summaries keep counting archived expenses: archiving
  cleans the board, not the history.

### Changed

- **Wider task modal on large screens (#201).** The detail panel scales up to
  `max-w-4xl` on 2xl viewports (896px at 1920, up from 672px).
- **Scalable filter bar (#202).** The Project and Label filter groups are now
  multi-select dropdowns with a selected-count badge, a search box past 8
  items and per-group clear; the popover is anchored to the viewport so the
  collapse wrapper cannot clip it. Person and Priority remain chips.

### Internal

- New `archived_at`/`done_at` columns on tasks and expenses (auto-migrated;
  `done_at` self-heals from `updated_at` for pre-migration rows). Positions
  are sequenced among active cards only. New endpoints
  `POST /api/{tasks,expenses}/:id/{archive,unarchive}` with 422 codes when
  the item is not done yet. Server suite 202/202, Playwright E2E 36/36.

## [2.6.22] - 2026-08-30

### Security

- **Timing-safe login.** `verifyLogin` now runs bcrypt against a dummy hash
  when the username is not found, preventing timing-based user enumeration.
- **Placeholder detection at startup.** The config validator rejects
  `.env.example` placeholder values (`cambia`, `changeme`, `example`, etc.)
  with a fail-fast error before the server starts listening.
- **Service worker bypass window.** After a new SW activates, all requests
  bypass cache for 30 seconds to ensure fresh assets are served post-deploy.

### Added

- **Shared Skeleton components.** `SkeletonList`, `SkeletonBoard`, and
  `SkeletonCard` with shimmer animation and `aria-hidden="true"`. Respects
  `prefers-reduced-motion`.
- **Shared EmptyState component.** Three variants (`empty`, `no-results`,
  `error`) with enforced icon-title-description-hint-CTA composition order
  and proper ARIA roles (`alert` for errors, `status` for no-results).

### Changed

- BoardPage, ExpenseBoard, and ActivityFeed now use the shared Skeleton and
  EmptyState components instead of ad-hoc `animate-pulse` blocks.

## [2.6.20] - 2026-08-29

### Fixed

- **Add Umami analytics tracker to the landing page (#196).** The landing now
  reports page views to `stat.domatix.com` so visits appear in Umami.

## [2.6.19] - 2026-08-28

### Changed

- **A failed update check is no longer silent (#181).** The server status now
  tells apart "up to date" from "could not check" (the shared GitHub rate
  limit used to degrade quietly into no-news), and the manual check in
  Settings explains the cause and when to retry.

## [2.6.17] - 2026-08-28

### Added

- **Updating now shows what changes and how far along it is (#189).** Clicking
  "Update now" opens a wizard with the current → latest version pair, the
  release notes as a changelog list, named steps (checking, downloading,
  verifying, installing, restarting) with a progress bar, and automatic reload
  once the server comes back. The update script reports its step to the data
  dir at every stage, and a new admin endpoint serves it with a staleness
  window so a dead run is never reported as in-flight. Failures keep the
  guarantees from #180: an expired session is explained instead of silently
  redirecting to login.

### Fixed

- **Another date-dependent recurrence test stopped exploding at midnight.**
  The integration test that moves a recurring task to done anchored on a fixed
  future date; it now computes its dates relative to the clock (same family as
  #182).

## [2.6.15] - 2026-08-27

### Changed

- **The update ribbon now appears on every view (#186).** The "new version
  available" check used to run only from the Settings page, so a published
  release stayed invisible everywhere else. The Layout now runs the check for
  admins on any view against the server endpoint (which compares the deployed
  marker with the latest stable release and caches the answer for five
  minutes), removing the browser-side GitHub call that the shared rate limit
  could silence. The banner is now a prominent solid banner when there is
  something to install, and it remains dismissible per version.

## [2.6.13] - 2026-08-27

### Fixed

- **The update banner no longer fails silently when the apply request errors
  (#180).** If the session cookie has expired, clicking "Update now" used to
  trigger a quiet redirect to the login page with no explanation while the
  update appeared to do nothing; the banner now keeps the error local,
  explains that the session has expired (with a reload button that lands on
  the login screen) and leaves the retry button available for any other
  failure. This was the real cause behind the "in-app update does nothing"
  report: the apply POST never reached the endpoint (401), and the update
  chain itself (flag, systemd path unit, root service) was healthy all along.

## [2.6.11] - 2026-08-23

### Security

- **Expense invite tokens are stored hashed only (#166).** The capability
  token is returned once at creation and only its SHA-256 hash is persisted;
  the plaintext column and the token retrieval endpoint are gone (a migration
  clears previously stored plaintext tokens), and the frontend drops the
  per-invite copy button (copying happens at creation).
- **Login rate limit can no longer be bypassed by spoofed X-Forwarded-For
  (#167).** The client IP for the login lockout now comes from the socket by
  default; the X-Forwarded-For header is only honored when `TRUSTED_PROXY` is
  configured and the direct peer matches it.
- **Session signing secret moves out of the database (#168).** `SESSION_SECRET`
  is now required from the environment in production (config validation); the
  automatic persistence in the database kv store remains as a development
  fallback only.
- **Task attachments respect project membership (#169).** `GET
  /api/attachments/:id` requires the requester to be a member of the task's
  project (404 to avoid revealing existence).
- **Home Assistant API routes respect project membership (#170).** The bearer
  token can only create tasks in projects of the configured user and only
  complete tasks in those projects.
- **HA token hash is compared in constant time (#171).** `crypto.timingSafeEqual`
  replaces the plain string comparison.

### Fixed

- **Profile update with `expenses_enabled` crashed with a SQLite bind error
  (#172).** The boolean is now coerced to 1/0 before binding.

### Changed

- **gitleaks ignore for test fixture credentials.** Add `.gitleaksignore` for
  the plaintext test password in `server/tests/auth.test.js` (not a production
  secret); the repo had no gitleaks ignore or CI scan yet.

## [2.6.9] - 2026-08-22

### Changed

- **Narrower project edit panel on desktop (#163).** The inline edit panel on
  the Projects page now spans about 2/3 of the usable width on large screens
  instead of the full grid.
- **Save button fits its content (#163).** The "Save changes" button in the
  project form no longer stretches across the whole form; it now sizes to its
  content.

## [2.6.7] - 2026-08-22

### Added

- **Natural language task creation (#152).** When creating a task, typing the
  title triggers a debounced parse that detects a due date and/or a recurrence
  from the text (Spanish and English), suggesting to fill the fields: "change
  the water filter every 6 months", "take the trash out every Monday and
  Tuesday", "review the car tomorrow", "pay the bill in 3 days". The temporal
  part is stripped from the title. Deterministic parser, no LLM.
- **Subtasks with automatic reset (#153).** Tasks can have nestable subtasks.
  Subtasks are added, toggled, edited inline and deleted from the task detail.
  When a recurring task is moved to done, its subtasks are copied to the next
  instance with done=0 (automatic reset), preserving nesting.
- **Home Assistant integration (#155).** Exposes tasks to Home Assistant over a
  REST API with a revocable bearer token, consumed natively by HA via a REST
  sensor (pending count) and rest_command (create/complete) - no custom HACS
  integration. Admin panel in Settings to generate/revoke the token and pick
  the user for the list.

### Fixed

- **Home Assistant panel i18n keys (#155).** The panel keys were nested under
  `settings.admin.ha.*` but referenced as `settings.ha.*`, so i18next showed
  the raw key instead of the label.

## [2.6.6] - 2026-08-22

### Added

- **Task recurrence with adaptive scheduling (#154).** Tasks can now repeat
  (daily, weekly or monthly, with optional specific weekdays). A recurrence
  config is set in the create and detail modals: frequency, interval, days of
  the week and how the next date is computed. Two modes are available:
  - **From due date:** constant cadence, the next instance is scheduled from
    the previous due date (e.g. always on a fixed weekday).
  - **Adaptive:** the next instance is scheduled from the real completion date
    using the median of the actual completion intervals of the series, falling
    back to the configured interval when there is no history yet.
  When a recurring task is moved to done, the next instance is created
  automatically in the To-do column with its computed due date, keeping the
  completed instance in history. Recurring tasks show a repeat badge on cards.

## [2.6.5] - 2026-08-15

### Added

- **Mobile slide transition between views (#146).** On phones, switching
  sections through the bottom navigation now slides the content in the
  direction of travel (forward/back based on nav order) while the header and
  bottom nav stay fixed. Built on the View Transitions API with a fallback to
  plain navigation where unsupported; respects `prefers-reduced-motion` and
  the in-app reduce-motion toggle. Re-tapping the active tab keeps the
  scroll-to-top behavior without a transition.
- **Automatic expense stage transitions and invites (#113 #128).** Creating an
  invite moves the expense from "New" to "In progress"; paying the last share
  (or last invite) completes it, and revoking invites reopens it. Invites can
  also be created from the create-expense flow, with a warning when shares
  plus invites exceed the total.

## [2.6.4] - 2026-08-13

### Added

- **Summary screen with reminders (#144).** The "Activity" entry in the main
  navigation is now **Summary**, a screen that surfaces what needs doing and
  what needs paying, ordered by urgency. It has two tabs:
  - **Reminders**: open tasks grouped by urgency (overdue, due today, next 7
    days, then no-date high-priority ones), sorted by due date then priority,
    plus the expenses where you owe unpaid shares and where others owe you
    unpaid shares on expenses you paid, with the pending amount of each.
  - **Activity**: the previous global activity feed, extracted into a reusable
    `ActivityFeed` component and still available at the `/activity` route.

## [2.6.3] - 2026-08-13

### Fixed

- Installed PWA stayed locked in portrait orientation on tablets: the manifest
  forced `portrait`; now `any` so the app rotates with the device. Also bump
  the SW cache version so installed PWAs pick up manifest changes. (#142)

## [2.6.2] - 2026-08-12

### Added

- **Touch drag and swipe on the mobile board (#136, #137).** On the board and
  the expense board you can now hold a card and drag it to another stage, or
  swipe a whole stage to move between columns. Dragging past an edge advances
  to the next stage live, so you can skip several columns without lifting your
  finger. Cards are always mounted on a horizontal track, so nothing
  re-renders mid-drag and the transition animates like switching desktop
  spaces. The release also brings icon-only task tabs on small screens and a
  compact board header on mobile.

### Fixed

- **Stuck floating card on repeated drags.** Grabbing the same card twice in a
  row could leave a phantom clone pinned to the screen. The cleanup now
  re-attaches its listeners and each gesture removes its own clone, with a
  watchdog and a global sweep as safety nets.

### Thanks

- **To whoever tested this on a real phone.** Touch gestures do not behave like
  the synthetic tests: the browser cancels streams, the PWA does not fire what
  Chrome does, and a passing Playwright run means nothing until the same finger
  tries it on the device. This feature cost a full day of on-device debugging,
  instrumented overlays on the phone screen, and patient feedback loop. It is
  the most expensive feature in the project so far, and it would not have
  shipped without it.

## [2.4.0] - 2026-08-09

### Added

- **Project sharing and membership (#50).** Projects now have members. A
  personal project is simply a project with no other members, and you can share
  a project with one or more specific people. Only members can see a project
  and its tasks; creating or editing tasks requires membership, and the assignee
  must be a member of the project. Existing projects are migrated so nobody
  loses access on upgrade. Owners manage members from the project form; other
  members get read-only project settings.
- **Board scope filter (part of #50).** An "All / Mine / Others" control on the
  board to focus on tasks assigned to you, to others, or all. Cards always show
  the assignee, so it is clear whose task it is without greying the shared board.
- **More project icons (#52).** The project icon picker ships ~25 additional
  curated Lucide icons (tools and maintenance, money and admin, travel and
  outdoors, tech and media, family and leisure).

### Changed

- **Sidebar entry to Projects (#51).** The tiny `+` text link next to the
  Projects section is now a clear icon button with a tooltip, and the section
  label is clickable too.

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
