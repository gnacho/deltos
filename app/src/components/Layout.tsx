import { useMemo, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { NavLink, Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  LayoutGrid,
  Folder,
  ListTodo,
  Repeat,
  Settings,
  Sun,
  Moon,
  Monitor,
  ChevronsLeft,
  ChevronsRight,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { useData } from '@/data/data-context';
import PullToRefresh from '@/components/PullToRefresh';
import { useSession } from '@/auth/session-context';
import { useTheme } from '@/theme/theme-context';
import type { ThemeMode } from '@/theme/theme-context';
import { apiFetch, apiPost, dispatchUnauthorized } from '@/data/api-client';
import { LogoMark } from '@/components/Logo';
import { Avatar } from '@/components/Avatar';
import { ConnectionDot } from '@/components/ConnectionDot';
import { colorOf } from '@/lib/colors';
import { ProjectIcon } from '@/components/ProjectIcon';
import { ModalContext, type NewTaskDefaults, type TaskTab } from '@/components/modal-context';
import { TaskModal } from '@/components/TaskModal';
import { useUpdateAvailable } from '@/hooks/useUpdateAvailable';
import { setUpdateBanner, useUpdateBanner } from '@/hooks/update-banner-store';
import { NewTaskModal } from '@/components/NewTaskModal';
import UpdateDialog from '@/components/UpdateDialog';
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
const UPDATE_CHECK_KEY = 'deltos-last-server-update-check';
const UPDATE_DISMISS_KEY = 'deltos-release-dismissed';
const UPDATE_URL = 'https://github.com/gnacho/deltos/releases';

/** Rutas del bottom-nav móvil en orden (para la dirección del deslizamiento). */
const BOTTOM_NAV_ORDER = ['/', '/projects', '/expenses', '/summary', '/routines', '/settings'];

function isActivePath(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  if (to === '/projects') return pathname.startsWith('/projects') || pathname.startsWith('/p/');
  return pathname.startsWith(to);
}

/** Índice del item de navegación (para la dirección del deslizamiento móvil). */
function navIndex(items: string[], path: string): number {
  return items.findIndex((to) => isActivePath(path, to));
}

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
        `group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-150 ${
          (active ?? isActive)
            ? 'bg-brand-soft text-brand font-medium'
            : 'text-muted hover:bg-hover hover:text-text-primary'
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

/** Banner "hay una nueva versión" (anti pantalla-negra + resultado del check). */
function UpdateBanner() {
  const { t } = useTranslation();
  const { demo } = useSession();
  const serverChanged = useUpdateAvailable(!demo);
  const checkResult = useUpdateBanner();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!serverChanged && !checkResult.available && !checkResult.swWaiting)
    return <>{dialogOpen && <UpdateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />}</>;

  // Estado "hay release nueva" (#186): banner sólido y notorio; el resto de
  // estados (redeploy del server) mantiene el aviso sutil.
  const notable = checkResult.available;
  const actionBtn = notable
    ? 'shrink-0 rounded-lg border border-white/30 bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/25 disabled:opacity-60'
    : 'shrink-0 rounded-lg bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-60';

  const applyAction =
    checkResult.swWaiting && checkResult.applySw ? (
      <button
        type="button"
        onClick={checkResult.applySw}
        className={actionBtn}
      >
        {t('update.reload')}
      </button>
    ) : checkResult.available && checkResult.applyRelease ? (
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={actionBtn}
      >
        {t('update.installNow')}
      </button>
    ) : checkResult.available && checkResult.url ? (
      <a
        href={checkResult.url}
        target="_blank"
        rel="noreferrer"
        className={actionBtn}
      >
        {t('update.openRelease')}
      </a>
    ) : (
      <button
        type="button"
        onClick={() => location.reload()}
        className={actionBtn}
      >
        {t('update.reload')}
      </button>
    );

  return (
    <>
      {dialogOpen && <UpdateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />}
      <div
        role="status"
        className={
          notable
            ? 'mb-4 flex items-center gap-3 rounded-xl border border-sky-700 bg-gradient-to-r from-sky-600 to-sky-700 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-sky-900/30'
            : 'mb-4 flex items-center gap-2.5 rounded-xl border border-sky-500/35 bg-sky-500/10 px-3.5 py-2.5 text-[13px] font-semibold text-sky-600 dark:text-sky-400'
        }
      >
        {notable ? (
          <RefreshCw className="h-5 w-5 shrink-0" aria-hidden />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500 animate-ping" />
        )}
        <span className="flex-1">
          {checkResult.available
            ? t('update.bannerNew', { version: checkResult.version })
            : t('update.banner')}
        </span>
        {applyAction}
        {checkResult.available && checkResult.dismissVersion && (
          <button
            type="button"
            onClick={checkResult.dismissVersion}
            className={
              notable
                ? 'shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white'
                : 'shrink-0 rounded-lg border border-sky-500/40 px-3 py-1 text-[12px] font-medium text-sky-500 hover:bg-sky-500/10'
            }
          >
            {t('update.dismiss')}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Check automático de actualizaciones en TODAS las vistas (#186): el server
 * compara marker vs última release (GET /api/update/status, caché kv 5 min)
 * y el resultado alimenta el ribbon global. Sin llamadas a GitHub desde el
 * navegador (evita el rate-limit de #181). Throttle semanal propio, distinto
 * del check manual de Ajustes; respeta el dismiss por versión. Solo admins.
 */
function UpdateAutoCheck() {
  const { user, demo } = useSession();
  const isAdmin = user?.role === 'admin' && !demo;
  useEffect(() => {
    if (!isAdmin) return;
    try {
      const last = Number(window.localStorage.getItem(UPDATE_CHECK_KEY) || 0);
      if (Date.now() - last < 7 * 24 * 60 * 60 * 1000) return;
      window.localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now()));
    } catch {
      /* sin storage: comprobar igualmente */
    }
    let stale = false;
    void (async () => {
      try {
        const s = await apiFetch<{ current: string; latest: string | null; available: boolean }>(
          '/api/update/status'
        );
        if (stale || !s?.available || !s.latest) return;
        const latest = s.latest;
        if (window.localStorage.getItem(UPDATE_DISMISS_KEY) === latest) return;
        setUpdateBanner({
          available: true,
          version: latest,
          url: UPDATE_URL,
          applyRelease: async () => {
            await apiPost('/api/update/apply', undefined, { noAuthEvent: true });
          },
          dismissVersion: () => {
            try {
              window.localStorage.setItem(UPDATE_DISMISS_KEY, latest);
            } catch {
              /* noop */
            }
            setUpdateBanner({ available: false });
          },
        });
      } catch {
        /* sin info de actualización: no molestar */
      }
    })();
    return () => {
      stale = true;
    };
  }, [isAdmin]);
  return null;
}

/** Barra de modo demo (patrón zfsctl): siempre visible con sesión demo. */function DemoBanner() {
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
  [/^\/summary/, 'nav.summary'],
  [/^\/routines/, 'nav.routines'],
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

  // Cada cambio de ruta resetea el scroll al principio (no hay ScrollRestoration).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  /* Re-tap del tab activo (o logo): scroll suave arriba. */
  const reduceMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const scrollTopIfActive = (to: string) => () => {
    const active =
      to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
    if (active && window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
  };

  /* Navegación móvil: el modo declarativo (BrowserRouter) no soporta la prop
   * viewTransition de react-router (solo RouterProvider), así que interceptamos
   * el click y envolvemos la navegación en document.startViewTransition (con
   * flushSync, igual que hace react-router internamente). La dirección del
   * deslizamiento se marca en <html data-nav-dir> antes del snapshot. */
  const handleMobileNav = (to: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const from = navIndex(BOTTOM_NAV_ORDER, location.pathname);
    const target = navIndex(BOTTOM_NAV_ORDER, to);
    if (target !== -1 && from !== target) {
      try {
        document.documentElement.dataset.navDir =
          from === -1 || target > from ? 'forward' : 'back';
      } catch {
        /* sin dataset */
      }
      scrollTopIfActive(to)();
      const doNavigate = () => navigate(to);
      if (typeof document.startViewTransition === 'function') {
        document.startViewTransition(() => flushSync(doNavigate));
      } else {
        doNavigate();
      }
    } else {
      scrollTopIfActive(to)();
      navigate(to, { replace: true });
    }
  };

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
    `w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors duration-150 ${
      isActive
        ? 'bg-brand-soft text-brand font-medium'
        : 'text-muted hover:bg-hover hover:text-text-primary'
    }`;

  const bnCls = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 transition-colors duration-150 rounded-lg ${
      active ? 'text-brand' : 'text-faint hover:bg-hover hover:text-text-primary'
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
            <IconNavLink to="/summary" label={t('nav.summary')}>
              <ListTodo className="w-[18px] h-[18px]" aria-hidden="true" />
            </IconNavLink>
            <IconNavLink to="/routines" label={t('nav.routines')}>
              <Repeat className="w-[18px] h-[18px]" aria-hidden="true" />
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
              <NavLink to="/summary" className={sideItemCls}>
                <span className="text-faint">
                  <ListTodo className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="flex-1 text-left">{t('nav.summary')}</span>
              </NavLink>
              <NavLink to="/routines" className={sideItemCls}>
                <span className="text-faint">
                  <Repeat className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="flex-1 text-left">{t('nav.routines')}</span>
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
                    className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors duration-150 ${
                      active
                        ? 'bg-brand-soft text-brand font-medium'
                        : 'text-muted hover:bg-hover hover:text-text-primary'
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
          <IconNavLink to="/summary" label={t('nav.summary')}>
            <ListTodo className="w-[18px] h-[18px]" aria-hidden="true" />
          </IconNavLink>
          <IconNavLink to="/routines" label={t('nav.routines')}>
            <Repeat className="w-[18px] h-[18px]" aria-hidden="true" />
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
        className="md:hidden fixed top-0 inset-x-0 h-14 bg-surface border-b border-app z-40 flex items-center gap-2 px-3 [view-transition-name:deltos-header]"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label={t('nav.goTodo')} onClick={scrollTopIfActive('/')}>
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
        className={`${lgMargin} md:pl-16 pt-[calc(56px+env(safe-area-inset-top))] md:pt-[calc(56px+16px)] pb-[calc(84px+env(safe-area-inset-bottom))] md:pb-8 [view-transition-name:deltos-content]`}
      >
        <PullToRefresh>
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
            <UpdateBanner />
            <UpdateAutoCheck />
            {demo && <DemoBanner />}
          </div>
          <Outlet />
        </PullToRefresh>
      </main>

      {/* ============ BOTTOM NAV MÓVIL (<md) ============ */}
      <nav
        className="bottom-nav md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-app [view-transition-name:deltos-nav]"
        aria-label={t('nav.main')}
      >
        <div className="h-16 grid grid-cols-6">
          <NavLink
            to="/"
            end
            className={({ isActive }) => bnCls(isActive)}
            aria-label={t('nav.todo')}
            onClick={handleMobileNav('/')}
          >
            <LayoutGrid className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.todo')}</span>
          </NavLink>
          <NavLink
            to="/projects"
            className={() => bnCls(isProjectsSection)}
            aria-label={t('nav.projects')}
            onClick={handleMobileNav('/projects')}
          >
            <Folder className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.projects')}</span>
          </NavLink>
          {showExpenses && (
            <NavLink
              to="/expenses"
              className={({ isActive }) => bnCls(isActive)}
              aria-label={t('nav.expenses')}
              onClick={handleMobileNav('/expenses')}
            >
              <Receipt className="w-5 h-5" aria-hidden="true" />
              <span className="text-[11px] font-medium">{t('nav.expenses')}</span>
            </NavLink>
          )}
          <NavLink
            to="/summary"
            className={({ isActive }) => bnCls(isActive)}
            aria-label={t('nav.summary')}
            onClick={handleMobileNav('/summary')}
          >
            <ListTodo className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.summary')}</span>
          </NavLink>
          <NavLink
            to="/routines"
            className={({ isActive }) => bnCls(isActive)}
            aria-label={t('nav.routines')}
            onClick={handleMobileNav('/routines')}
          >
            <Repeat className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.routines')}</span>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => bnCls(isActive)}
            aria-label={t('nav.settings')}
            onClick={handleMobileNav('/settings')}
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
