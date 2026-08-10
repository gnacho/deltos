import { useMemo, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  LayoutGrid,
  Folder,
  Clock,
  Settings,
  Sun,
  Moon,
  Monitor,
  ChevronsLeft,
  ChevronsRight,
  Receipt,
} from 'lucide-react';
import { useData } from '@/data/data-context';
import PullToRefresh from '@/components/PullToRefresh';
import { useSession } from '@/auth/session-context';
import { useTheme } from '@/theme/theme-context';
import type { ThemeMode } from '@/theme/theme-context';
import { apiPost, dispatchUnauthorized } from '@/data/api-client';
import { LogoMark } from '@/components/Logo';
import { Avatar } from '@/components/Avatar';
import { ConnectionDot } from '@/components/ConnectionDot';
import { colorOf } from '@/lib/colors';
import { ProjectIcon } from '@/components/ProjectIcon';
import { ModalContext, type NewTaskDefaults, type TaskTab } from '@/components/modal-context';
import { TaskModal } from '@/components/TaskModal';
import { useUpdateAvailable } from '@/hooks/useUpdateAvailable';
import { useUpdateBanner } from '@/hooks/update-banner-store';
import { NewTaskModal } from '@/components/NewTaskModal';
import { VersionFooter } from '@/components/VersionFooter';

/**
 * AppLayout unificado (skill webapp-shell):
 *  - ≥lg: sidebar 232px colapsable a raíl 64px (persiste en deltos-sidebar-collapsed)
 *  - md: raíl 64px con tooltips
 *  - <md: header móvil + bottom nav (4 items)
 *  - Topbar desktop/tablet: título | selector de tablero, conexión, tema
 *  - DemoBanner (patrón zfsctl) cuando la sesión es demo
 *  - Conserva: ModalContext, modales globales, select de tablero, a11y-announce
 */

const COLLAPSED_KEY = 'deltos-sidebar-collapsed';

function ThemeTogglePill() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const opts: { m: ThemeMode; icon: typeof Sun; label: string }[] = [
    { m: 'auto', icon: Monitor, label: t('settings.themeAuto') },
    { m: 'light', icon: Sun, label: t('settings.themeLight') },
    { m: 'dark', icon: Moon, label: t('settings.themeDark') },
  ];
  return (
    <div role="radiogroup" aria-label={t('settings.appearance')} className="flex h-8 items-center rounded-full border border-app bg-surface2 p-0.5">
      {opts.map(({ m, icon: Icon, label }) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(m)}
            className={`relative flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors${
              active ? ' bg-surface shadow-soft text-text' : ' text-muted hover:text-text'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThemeToggleButton({ mobile }: { mobile?: boolean }) {
  const { t } = useTranslation();
  const { dark, toggle } = useTheme();
  const label = dark ? t('settings.themeToLight') : t('settings.themeToDark');
  const icon = dark ? (
    <Sun className="w-[18px] h-[18px]" aria-hidden="true" />
  ) : (
    <Moon className="w-[18px] h-[18px]" aria-hidden="true" />
  );
  if (mobile) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center shrink-0 border border-app"
        aria-label={label}
      >
        {icon}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface2"
      aria-label={label}
    >
      {icon}
      <span>{dark ? t('settings.themeLightShort') : t('settings.themeDarkShort')}</span>
    </button>
  );
}

function AmbientGlow() {
  const { dark } = useTheme();
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 pointer-events-none"
      style={{
        background: `radial-gradient(circle at 50% -10%, rgba(var(--accent-rgb), ${dark ? 0.08 : 0.04}) 0%, rgba(var(--accent-rgb), 0) 55%), var(--bg)`,
        transition: 'background 0.45s ease',
      }}
    />
  );
}

/** Item de navegación solo-icono con tooltip (raíl md y sidebar colapsado). */
function IconNavLink({
  to,
  end,
  label,
  children,
  active,
}: {
  to: string;
  end?: boolean;
  label: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        `group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
          (active ?? isActive) ? 'bg-surface2 font-medium' : 'text-muted hover:bg-surface2'
        }`
      }
    >
      {children}
      <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-app bg-surface px-2 py-1 text-xs group-hover:block">
        {label}
      </span>
    </NavLink>
  );
}

/** Banner "hay una nueva versión" (anti pantalla-negra + resultado del check de GitHub). */
function UpdateBanner() {
  const { t } = useTranslation();
  const { demo } = useSession();
  const serverChanged = useUpdateAvailable(!demo);
  const checkResult = useUpdateBanner();
  const [applying, setApplying] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  if (!serverChanged && !checkResult.available && !checkResult.swWaiting) return null;

  const versionSig = () =>
    fetch('/api/version', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j ? `${j.version}+${j.build}` : ''))
      .catch(() => '');

  const applyRelease = async () => {
    if (!checkResult.applyRelease || applying) return;
    setApplying(true);
    setTimedOut(false);
    try {
      const before = await versionSig();
      await checkResult.applyRelease(); // POST apply → flag → 202 (async)
      // El root update service corre en segundo plano; sondea hasta que el
      // build del servidor cambie (se reinicia con el código nuevo).
      const deadline = Date.now() + 90000;
      const poll = async () => {
        const sig = await versionSig();
        if (before && sig && sig !== before) {
          location.reload();
          return;
        }
        if (Date.now() < deadline) window.setTimeout(poll, 2500);
        else {
          setApplying(false);
          setTimedOut(true);
        }
      };
      window.setTimeout(poll, 3000);
    } catch {
      setApplying(false);
    }
  };

  const applyAction =
    checkResult.swWaiting && checkResult.applySw ? (
      <button
        type="button"
        onClick={checkResult.applySw}
        className="shrink-0 rounded-lg bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110"
      >
        {t('update.reload')}
      </button>
    ) : checkResult.available && checkResult.applyRelease ? (
      timedOut ? (
        <button
          type="button"
          onClick={() => location.reload()}
          className="shrink-0 rounded-lg bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110"
        >
          {t('update.reload')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void applyRelease()}
          disabled={applying}
          className="shrink-0 rounded-lg bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
        >
          {applying ? t('update.applying') : t('update.installNow')}
        </button>
      )
    ) : checkResult.available && checkResult.url ? (
      <a
        href={checkResult.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-lg bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110"
      >
        {t('update.openRelease')}
      </a>
    ) : (
      <button
        type="button"
        onClick={() => location.reload()}
        className="shrink-0 rounded-lg bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110"
      >
        {t('update.reload')}
      </button>
    );

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl border border-sky-500/35 bg-sky-500/10 px-3.5 py-2.5 text-[13px] font-semibold text-sky-600 dark:text-sky-400"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500 animate-ping" />
      <span className="flex-1">
        {timedOut
          ? t('update.applyTimeout')
          : checkResult.available
            ? t('update.bannerNew', { version: checkResult.version })
            : t('update.banner')}
      </span>
      {applyAction}
      {checkResult.available && checkResult.dismissVersion && (
        <button
          type="button"
          onClick={checkResult.dismissVersion}
          className="shrink-0 rounded-lg border border-sky-500/40 px-3 py-1 text-[12px] font-medium text-sky-500 hover:bg-sky-500/10"
        >
          {t('update.dismiss')}
        </button>
      )}
    </div>
  );
}

/** Barra de modo demo (patrón zfsctl): siempre visible con sesión demo. */
function DemoBanner() {
  const { t } = useTranslation();
  const exitDemo = async () => {
    try {
      await apiPost('/api/auth/logout');
    } finally {
      dispatchUnauthorized();
    }
  };
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-[13px] font-semibold text-amber-600 dark:text-amber-400"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500 animate-ping" />
      <span>{t('demo.banner')}</span>
      <button
        type="button"
        onClick={exitDemo}
        className="ml-auto flex h-8 items-center rounded-lg border border-amber-500/40 px-3 text-xs font-medium transition-colors hover:bg-amber-500/15"
      >
        {t('demo.exit')}
      </button>
    </div>
  );
}

const TITLE_KEYS: [RegExp, string][] = [
  [/^\/$/, 'nav.todo'],
  [/^\/projects/, 'nav.projects'],
  [/^\/activity/, 'nav.activity'],
  [/^\/expenses/, 'nav.expenses'],
  [/^\/settings/, 'nav.settings'],
];

export default function Layout() {
  const { t } = useTranslation();
  const { user, demo } = useSession();
  const showExpenses = user.expenses_enabled !== false;
  const data = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();

  const [openTask, setOpenTask] = useState<{ id: string; tab: TaskTab } | null>(null);
  const [newTask, setNewTask] = useState<NewTaskDefaults | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [boardOpen, setBoardOpen] = useState(false);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1');
      } catch {
        /* sin localStorage */
      }
      return !prev;
    });
  };

  const modalApi = useMemo(
    () => ({
      openTask: (id: string, tab?: TaskTab) => setOpenTask({ id, tab: tab ?? 'detalles' }),
      openNewTask: (defaults?: NewTaskDefaults) => setNewTask(defaults ?? {}),
    }),
    [],
  );

  const projects = data.getProjects();
  const tasks = data.getTasks();
  const openAll = tasks.filter((tk) => tk.column !== 'hecho').length;

  const boardView: 'todo' | 'project' | null = location.pathname.startsWith('/p/')
    ? 'project'
    : location.pathname === '/'
      ? 'todo'
      : null;
  const currentProjectId = params.projectId ?? null;
  const currentProject = currentProjectId ? projects.find((p) => p.id === currentProjectId) : null;

  const titleKey = TITLE_KEYS.find(([re]) => re.test(location.pathname))?.[1];
  const title =
    boardView === 'project'
      ? (currentProject?.name ?? t('nav.projects'))
      : t(titleKey ?? 'nav.todo');

  const sideItemCls = ({ isActive }: { isActive: boolean }) =>
    `w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-surface2 font-medium' : 'text-muted hover:bg-surface2'
    }`;

  const bnCls = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 transition-colors ${
      active ? 'text-brand' : 'text-faint hover:text-muted hover:bg-surface2 rounded-lg'
    }`;

  const isProjectsSection = location.pathname.startsWith('/projects') || boardView === 'project';
  const lgMargin = collapsed ? 'lg:pl-16' : 'lg:pl-[232px]';

  const boardSelect = boardView !== null && (
    <>
      <label className="sr-only" id="board-view-label">
        {t('nav.boardSelect')}
      </label>
      <div className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={boardOpen}
          aria-labelledby="board-view-label"
          onClick={() => setBoardOpen((o) => !o)}
          className="max-w-[220px] inline-flex items-center gap-2 bg-surface2 border border-app rounded-lg pl-2.5 pr-2 py-1.5 text-sm font-medium appearance-none outline-none focus:border-brand"
        >
          {boardView === 'project' && currentProject ? (
            <>
              <ProjectIcon name={currentProject.emoji} className="w-4 h-4 text-muted shrink-0" />
              <span className="truncate">{currentProject.name}</span>
            </>
          ) : (
            <>
              <LayoutGrid className="w-4 h-4 text-muted shrink-0" aria-hidden="true" />
              <span>{t('nav.todo')}</span>
            </>
          )}
          <ChevronsRight
            className={`w-3.5 h-3.5 text-faint shrink-0 transition-transform duration-200 ${boardOpen ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
        </button>
        {boardOpen && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => setBoardOpen(false)}
              aria-hidden="true"
            />
            <ul
              role="listbox"
              aria-label={t('nav.boardSelect')}
              className="absolute z-30 right-0 mt-1.5 w-56 max-h-80 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
            >
              <li role="option" aria-selected={boardView === 'todo'}>
                <button
                  type="button"
                  onClick={() => {
                    setBoardOpen(false);
                    if (boardView !== 'todo') navigate('/');
                  }}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                    boardView === 'todo' ? 'font-medium text-brand' : 'text-muted'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{t('nav.todo')}</span>
                </button>
              </li>
              {projects.map((p) => {
                const active = boardView === 'project' && currentProjectId === p.id;
                return (
                  <li key={p.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        setBoardOpen(false);
                        if (!active) navigate(`/p/${p.id}`);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                        active ? 'font-medium text-brand' : 'text-muted'
                      }`}
                    >
                      <ProjectIcon name={p.emoji} className="w-4 h-4 shrink-0" />
                      <span className="flex-1 truncate">{p.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );

  return (
    <ModalContext.Provider value={modalApi}>
      <AmbientGlow />
      {/* ============ SIDEBAR (lg+, colapsable) ============ */}
      {collapsed ? (
        <aside className="hidden lg:flex fixed inset-y-0 left-0 w-16 flex-col items-center bg-surface border-r border-app z-40 py-3">
          <Link
            to="/"
            aria-label={t('nav.goTodo')}
            className="flex h-16 items-center justify-center"
          >
            <LogoMark size={30} />
          </Link>
          <nav
            className="mt-2 flex flex-1 flex-col items-center gap-1 overflow-y-auto nice-scroll"
            aria-label={t('nav.main')}
          >
            <IconNavLink to="/" end label={t('nav.todo')}>
              <LayoutGrid className="w-[18px] h-[18px]" aria-hidden="true" />
            </IconNavLink>
            <IconNavLink to="/activity" label={t('nav.activity')}>
              <Clock className="w-[18px] h-[18px]" aria-hidden="true" />
            </IconNavLink>
            {showExpenses && (
              <IconNavLink to="/expenses" label={t('nav.expenses')}>
                <Receipt className="w-[18px] h-[18px]" aria-hidden="true" />
              </IconNavLink>
            )}
            <IconNavLink to="/settings" label={t('nav.settings')}>
              <Settings className="w-[18px] h-[18px]" aria-hidden="true" />
            </IconNavLink>
            <span className="my-2 h-px w-8 bg-[var(--border)]" aria-hidden="true" />
            {projects.map((p) => (
              <IconNavLink
                key={p.id}
                to={`/p/${p.id}`}
                label={p.name}
                active={currentProjectId === p.id}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${colorOf(p.color).dot}`}
                  aria-hidden="true"
                />
              </IconNavLink>
            ))}
            <IconNavLink
              to="/projects"
              label={t('nav.projects')}
              active={location.pathname.startsWith('/projects')}
            >
              <Folder className="w-[18px] h-[18px]" aria-hidden="true" />
            </IconNavLink>
          </nav>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label={t('nav.expand')}
              className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center border border-app"
            >
              <ChevronsRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </aside>
      ) : (
        <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[232px] flex-col bg-surface border-r border-app z-40">
          <div className="px-4 pt-5 pb-4">
            <Link to="/" className="flex items-center gap-2.5 group" aria-label={t('nav.goTodo')}>
              <LogoMark size={32} />
              <span className="font-display font-bold text-lg tracking-tight">
                {t('common.appName')}
              </span>
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto nice-scroll px-3 pb-3" aria-label={t('nav.main')}>

            <div className="space-y-0.5 mb-5">
              <NavLink to="/" end className={sideItemCls}>
                <span className="text-faint">
                  <LayoutGrid className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="flex-1 text-left">{t('nav.todo')}</span>
                <span className="tnum text-xs text-faint">{openAll}</span>
              </NavLink>
              <NavLink to="/activity" className={sideItemCls}>
                <span className="text-faint">
                  <Clock className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="flex-1 text-left">{t('nav.activity')}</span>
              </NavLink>
              {showExpenses && (
                <NavLink to="/expenses" className={sideItemCls}>
                  <span className="text-faint">
                    <Receipt className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <span className="flex-1 text-left">{t('nav.expenses')}</span>
                </NavLink>
              )}
            </div>
            <div className="flex items-center justify-between px-2 pb-2">
              <Link
                to="/projects"
                className="text-[11px] font-semibold tracking-widest text-faint hover:text-muted"
                aria-label={t('nav.projects')}
              >
                {t('nav.projectsSection')}
              </Link>
              <Link
                to="/projects"
                aria-label={t('nav.projects')}
                title={t('nav.projects')}
                className="inline-flex w-7 h-7 items-center justify-center rounded-lg text-faint hover:bg-surface2 hover:text-text"
              >
                <LayoutGrid className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="space-y-0.5">
              {projects.map((p) => {
                const open = p.counts.nuevo + p.counts.encurso;
                const active = currentProjectId === p.id;
                return (
                  <Link
                    key={p.id}
                    to={`/p/${p.id}`}
                    className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                      active ? 'bg-surface2 font-medium' : 'text-muted hover:bg-surface2'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${colorOf(p.color).dot}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 text-left truncate">{p.name}</span>
                    <span className="tnum text-xs text-faint">{open}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="border-t border-app p-3 space-y-2">
            <div className="flex items-center gap-2">
              <NavLink
                to="/settings"
                className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                  location.pathname.startsWith('/settings')
                    ? 'bg-brand/10 text-brand'
                    : 'text-muted hover:bg-surface2'
                }`}
              >
                <Settings className="w-[18px] h-[18px]" aria-hidden="true" />
                <span>{t('nav.settings')}</span>
              </NavLink>
              <button
                type="button"
                onClick={toggleCollapse}
                aria-label={t('nav.collapse')}
                className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center border border-app shrink-0"
              >
                <ChevronsLeft className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ============ RAIL (md) ============ */}
      <aside className="hidden md:flex lg:hidden fixed inset-y-0 left-0 w-16 flex-col items-center bg-surface border-r border-app z-40 py-3">
        <Link to="/" aria-label={t('nav.goTodo')} className="flex h-16 items-center justify-center">
          <LogoMark size={30} />
        </Link>
        <nav className="mt-2 flex flex-1 flex-col items-center gap-1" aria-label={t('nav.main')}>
          <IconNavLink to="/" end label={t('nav.todo')}>
            <LayoutGrid className="w-[18px] h-[18px]" aria-hidden="true" />
          </IconNavLink>
          <IconNavLink to="/projects" label={t('nav.projects')} active={isProjectsSection}>
            <Folder className="w-[18px] h-[18px]" aria-hidden="true" />
          </IconNavLink>
          <IconNavLink to="/activity" label={t('nav.activity')}>
            <Clock className="w-[18px] h-[18px]" aria-hidden="true" />
          </IconNavLink>
          {showExpenses && (
            <IconNavLink to="/expenses" label={t('nav.expenses')}>
              <Receipt className="w-[18px] h-[18px]" aria-hidden="true" />
            </IconNavLink>
          )}
          <IconNavLink to="/settings" label={t('nav.settings')}>
            <Settings className="w-[18px] h-[18px]" aria-hidden="true" />
          </IconNavLink>
        </nav>
      </aside>

      {/* ============ TOPBAR (md+) ============ */}
      <header
        className={`hidden md:flex fixed top-0 inset-x-0 h-14 bg-surface/85 backdrop-blur-[16px] border-b border-app z-30 items-center justify-between gap-3 px-6 md:ml-16 ${lgMargin}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <h1 className="font-display font-bold text-lg tracking-tight truncate">{title}</h1>
        <div className="flex items-center gap-3">
          {boardSelect}
          <ThemeTogglePill />
          <div className="flex items-center gap-2">
            <Avatar name={user.username} color={user.color} size="sm" />
            <span className="text-sm font-medium truncate max-w-[100px]">{user.username}</span>
          </div>
        </div>
      </header>

      {/* ============ HEADER MÓVIL (<md) ============ */}
      <header
        className="md:hidden fixed top-0 inset-x-0 h-14 bg-surface border-b border-app z-40 flex items-center gap-2 px-3"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label={t('nav.goTodo')}>
          <LogoMark size={28} />
          <span className="font-display font-bold text-base tracking-tight">
            {t('common.appName')}
          </span>
        </Link>
        <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
          {boardView !== null ? boardSelect : <ConnectionDot />}
        </div>
        <ThemeToggleButton mobile />
      </header>

      {/* ============ CONTENIDO ============ */}
      <main
        className={`${lgMargin} md:pl-16 pt-[68px] md:pt-[calc(56px+16px)] pb-[calc(84px+env(safe-area-inset-bottom))] md:pb-8`}
      >
        <PullToRefresh>
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
            <UpdateBanner />
            {demo && <DemoBanner />}
          </div>
          <Outlet />
        </PullToRefresh>
      </main>

      {/* ============ BOTTOM NAV MÓVIL (<md) ============ */}
      <nav
        className="bottom-nav md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-app"
        aria-label={t('nav.main')}
      >
        <div className="h-16 grid grid-cols-5">
          <NavLink
            to="/"
            end
            className={({ isActive }) => bnCls(isActive)}
            aria-label={t('nav.todo')}
          >
            <LayoutGrid className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.todo')}</span>
          </NavLink>
          <NavLink
            to="/projects"
            className={() => bnCls(isProjectsSection)}
            aria-label={t('nav.projects')}
          >
            <Folder className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.projects')}</span>
          </NavLink>
          {showExpenses && (
            <NavLink
              to="/expenses"
              className={({ isActive }) => bnCls(isActive)}
              aria-label={t('nav.expenses')}
            >
              <Receipt className="w-5 h-5" aria-hidden="true" />
              <span className="text-[11px] font-medium">{t('nav.expenses')}</span>
            </NavLink>
          )}
          <NavLink
            to="/activity"
            className={({ isActive }) => bnCls(isActive)}
            aria-label={t('nav.activity')}
          >
            <Clock className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.activity')}</span>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => bnCls(isActive)}
            aria-label={t('nav.settings')}
          >
            <Settings className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.settings')}</span>
          </NavLink>
        </div>
      </nav>

      {/* Modales globales */}
      {openTask && (
        <TaskModal
          taskId={openTask.id}
          initialTab={openTask.tab}
          onClose={() => setOpenTask(null)}
        />
      )}
      {newTask && <NewTaskModal defaults={newTask} onClose={() => setNewTask(null)} />}

      {/* Avisador discreto para lector de pantalla (movimientos de tarjetas) */}
      <div
        id="a11y-announce"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-label={t('a11y.announce')}
      />
      <VersionFooter />
    </ModalContext.Provider>
  );
}
