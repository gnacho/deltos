import { useMemo, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Folder, Clock, Settings, Sun, Moon } from 'lucide-react';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { useTheme } from '@/theme/theme-context';
import { LogoMark } from '@/components/Logo';
import { Avatar } from '@/components/Avatar';
import { DemoBadge } from '@/components/badges';
import { ConnectionDot } from '@/components/ConnectionDot';
import { colorOf } from '@/lib/colors';
import { SELECT_STYLE } from '@/lib/select-style';
import { ModalContext, type NewTaskDefaults, type TaskTab } from '@/components/modal-context';
import { TaskModal } from '@/components/TaskModal';
import { NewTaskModal } from '@/components/NewTaskModal';

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
        className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center shrink-0"
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

export default function Layout() {
  const { t } = useTranslation();
  const { user, demo } = useSession();
  const data = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();

  const [openTask, setOpenTask] = useState<{ id: string; tab: TaskTab } | null>(null);
  const [newTask, setNewTask] = useState<NewTaskDefaults | null>(null);

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

  const sideItemCls = ({ isActive }: { isActive: boolean }) =>
    `w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${
      isActive ? 'bg-surface2 font-medium' : 'text-muted hover:bg-surface2'
    }`;

  const bnCls = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1 ${
      active ? 'text-emerald-700 dark:text-emerald-400' : 'text-faint'
    }`;

  const isProjectsSection = location.pathname.startsWith('/projects') || boardView === 'project';

  return (
    <ModalContext.Provider value={modalApi}>
      {/* ============ SIDEBAR (lg+) ============ */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[232px] flex-col bg-surface border-r border-app z-40">
        <div className="px-4 pt-5 pb-4">
          <Link to="/" className="flex items-center gap-2.5 group" aria-label={t('nav.goTodo')}>
            <LogoMark size={32} />
            <span className="font-display font-bold text-lg tracking-tight">
              {t('common.appName')}
            </span>
            {demo && <DemoBadge />}
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
            <NavLink to="/settings" className={sideItemCls}>
              <span className="text-faint">
                <Settings className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="flex-1 text-left">{t('nav.settings')}</span>
            </NavLink>
          </div>
          <div className="flex items-center justify-between px-2 pb-2">
            <p className="text-[11px] font-semibold tracking-widest text-faint">
              {t('nav.projectsSection')}
            </p>
            <Link
              to="/projects"
              className="text-[11px] font-medium text-faint hover:text-muted"
              aria-label={t('nav.projects')}
            >
              +
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
                  className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${
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

        <div className="border-t border-app p-3 space-y-1">
          <div className="px-3 pb-1">
            <ConnectionDot />
          </div>
          <ThemeToggleButton />
          <div className="flex items-center gap-2.5 rounded-xl px-3 py-2">
            <Avatar name={user.username} color={user.color} size="lg" />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight truncate">{user.username}</p>
              <p className="text-xs text-faint leading-tight">{t('nav.currentAccount')}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ============ HEADER MÓVIL (<lg) ============ */}
      <header
        className="lg:hidden fixed top-0 inset-x-0 h-14 bg-surface border-b border-app z-40 flex items-center gap-2 px-3"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label={t('nav.goTodo')}>
          <LogoMark size={28} />
          <span className="font-display font-bold text-base tracking-tight">
            {t('common.appName')}
          </span>
          {demo && <DemoBadge />}
        </Link>
        <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
          {boardView !== null && <ConnectionDot withLabel={false} />}
          {boardView !== null ? (
            <>
              <label className="sr-only" htmlFor="mobile-view">
                {t('nav.boardSelect')}
              </label>
              <select
                id="mobile-view"
                value={boardView === 'project' && currentProjectId ? currentProjectId : 'todo'}
                onChange={(e) => {
                  const v = e.target.value;
                  navigate(v === 'todo' ? '/' : `/p/${v}`);
                }}
                className="max-w-[180px] truncate bg-surface2 border border-app rounded-lg pl-2.5 pr-7 py-1.5 text-sm font-medium appearance-none bg-no-repeat"
                style={SELECT_STYLE}
              >
                <option value="todo">📋 {t('nav.todo')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji} {p.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <ConnectionDot />
          )}
        </div>
        <ThemeToggleButton mobile />
      </header>

      {/* ============ CONTENIDO ============ */}
      <main className="lg:pl-[232px] pt-[68px] lg:pt-0 pb-[calc(84px+env(safe-area-inset-bottom))] lg:pb-8">
        <Outlet />
      </main>

      {/* ============ BOTTOM NAV MÓVIL ============ */}
      <nav
        className="bottom-nav lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-app"
        aria-label={t('nav.main')}
      >
        <div className="h-16 grid grid-cols-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) => bnCls(isActive)}
            aria-label={t('nav.todo')}
          >
            {({ isActive }) => (
              <>
                <LayoutGrid className="w-5 h-5" aria-hidden="true" />
                <span className="text-[11px] font-medium">{t('nav.todo')}</span>
                {isActive && <span className="sr-only">({t('nav.todo')})</span>}
              </>
            )}
          </NavLink>
          <NavLink
            to="/projects"
            className={() => bnCls(isProjectsSection)}
            aria-label={t('nav.projects')}
          >
            <Folder className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-medium">{t('nav.projects')}</span>
          </NavLink>
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
    </ModalContext.Provider>
  );
}
