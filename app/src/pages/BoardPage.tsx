import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Plus, Settings2, ChevronDown, Repeat } from 'lucide-react';
import type { ColumnId, Task } from '@/data/types';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { useTaskModal } from '@/components/modal-context';
import { TaskCard, TaskCardMobile } from '@/components/TaskCard';
import { MobileMoveCard } from '@/components/MobileMoveCard';
import { useKanbanDnD } from '@/hooks/useKanbanDnD';
import { useStepSwipe } from '@/hooks/useStepSwipe';
import { Filters, FiltersToggleButton } from '@/components/Filters';
import { emptyFilters, type FilterState } from '@/components/filters-state';
import { COLUMNS } from '@/lib/constants';
import { SkeletonBoard } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { colorOf, COLUMN_ACCENT_RGB } from '@/lib/colors';
import { announce } from '@/lib/announce';
import { ProjectActions } from '@/components/ProjectActions';

export default function BoardPage() {
  const { t } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const { openTask, openNewTask } = useTaskModal();
  const { projectId } = useParams<{ projectId: string }>();
  const view = projectId ?? 'todo';
  const isTodo = view === 'todo';

  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [scope, setScope] = useState<'all' | 'mine' | 'others'>('all');
  const [seg, setSeg] = useState<ColumnId>('nuevo');
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [projectActionsOpen, setProjectActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const activeFilterCount =
    filters.projects.size + filters.people.size + filters.priorities.size + filters.tags.size;

  const boardRef = useRef<HTMLDivElement>(null);
  const mobileTrackRef = useRef<HTMLDivElement>(null);

  /* Posiciona el track móvil sobre la etapa activa con transición (slide). */
  const segIdx = COLUMNS.findIndex((c) => c.id === seg);
  useEffect(() => {
    const el = mobileTrackRef.current;
    if (!el) return;
    el.style.transition = 'transform 0.32s cubic-bezier(0.3, 0.7, 0.3, 1)';
    el.style.transform = `translate3d(-${Math.max(0, segIdx) * 100}%, 0, 0)`;
  }, [segIdx]);

  /* 🔥 RED GLOBAL: cualquier clon/fantasma/velo huérfano del drag móvil se
     elimina periódicamente. No depende de los flujos internos del componente:
     garantiza que una tarjeta superpuesta NUNCA quede en pantalla. */
  useEffect(() => {
    const sweep = () => {
      if (document.body.classList.contains('mm-dragging')) return;
      document
        .querySelectorAll('.mm-clone:not([data-flying]), .mm-ghost, .mm-dim')
        .forEach((el) => el.remove());
    };
    const iv = window.setInterval(sweep, 1500);
    const onVisibility = () => {
      if (document.hidden) sweep();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onVisibility);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onVisibility);
    };
  }, []);

  const tasks = data.getTasks();
  const project = isTodo ? undefined : data.getProject(view);

  /* Tareas visibles según vista + filtros + alcance (todas/mías/de otras).
   * Las archivadas quedan aparte: solo se ven con "mostrar archivadas". */
  const { visible, archivedList } = useMemo(() => {
    let list = isTodo ? tasks.slice() : tasks.filter((tk) => tk.project_id === view);
    if (isTodo) {
      const f = filters;
      if (f.projects.size) list = list.filter((tk) => f.projects.has(tk.project_id));
      if (f.people.size) list = list.filter((tk) => f.people.has(tk.assignee_id ?? 'none'));
      if (f.priorities.size)
        list = list.filter((tk) => tk.priority !== null && f.priorities.has(tk.priority));
      if (f.tags.size) list = list.filter((tk) => tk.labels.some((l) => f.tags.has(l.id)));
    }
    if (scope === 'mine') list = list.filter((tk) => tk.assignee_id === me.id);
    else if (scope === 'others')
      list = list.filter((tk) => tk.assignee_id !== null && tk.assignee_id !== me.id);
    if (recurringOnly) list = list.filter((tk) => tk.recurrence);
    return {
      visible: list.filter((tk) => !tk.archived_at),
      archivedList: list
        .filter((tk) => tk.archived_at && tk.column === 'hecho')
        .sort((a, b) => a.position - b.position),
    };
  }, [tasks, isTodo, view, filters, scope, recurringOnly, me.id]);

  const byColumn = useMemo(() => {
    const map = new Map<ColumnId, Task[]>();
    for (const c of COLUMNS) {
      map.set(
        c.id,
        visible.filter((tk) => tk.column === c.id).sort((a, b) => a.position - b.position),
      );
    }
    return map;
  }, [visible]);

  const openCount = visible.filter((tk) => tk.column !== 'hecho').length;

  /* ---------- DnD compartido (hook): antes de los early-returns ---------- */

  const doMove = async (id: string, toCol: ColumnId, refId: string | null) => {
    const task = data.getTask(id);
    if (!task) return false;
    /* Posición = índice en la columna completa (sin filtros ni archivadas),
     * excluyendo la arrastrada */
    const colTasks = tasks
      .filter((tk) => !tk.archived_at && tk.column === toCol && tk.id !== id)
      .sort((a, b) => a.position - b.position);
    let position = colTasks.length;
    if (refId) {
      const ri = colTasks.findIndex((tk) => tk.id === refId);
      if (ri !== -1) position = ri;
    }
    const fromCol = task.column;
    try {
      await data.moveTask(id, toCol, position);
      const colName = t(`columns.${toCol}`);
      announce(
        fromCol !== toCol
          ? t('board.movedTo', { title: task.title, column: colName })
          : t('board.reordered', { title: task.title, column: colName }),
      );
      return true;
    } catch {
      announce(t('common.error'));
      return false;
    }
  };

  const doArchive = async (id: string) => {
    const task = data.getTask(id);
    try {
      await data.archiveTask(id);
      announce(t('board.taskArchived', { title: task?.title ?? '' }));
    } catch {
      announce(t('common.error'));
    }
  };

  const doUnarchive = async (id: string) => {
    const task = data.getTask(id);
    try {
      await data.unarchiveTask(id);
      announce(t('board.taskUnarchived', { title: task?.title ?? '' }));
    } catch {
      announce(t('common.error'));
    }
  };

  const activeTasks = useMemo(() => tasks.filter((tk) => !tk.archived_at), [tasks]);

  const dnd = useKanbanDnD<ColumnId>({
    boardRef,
    items: activeTasks,
    onMove: (id, toCol, refId) => void doMove(id, toCol, refId),
  });

  const doMoveMobile = async (id: string, toCol: string) => {
    const ok = await doMove(id, toCol as ColumnId, null);
    /* Tras el drag, la vista debe quedarse en la etapa de destino (si no, la
       tarjeta se mueve en la BD pero el board sigue mostrando la etapa inicial). */
    if (ok) setSeg(toCol as ColumnId);
  };

  useStepSwipe<ColumnId>(COLUMNS.map((c) => c.id), seg, setSeg, mobileTrackRef, data.ready);

  if (!data.ready) {
    if (data.bootstrapError) {
      return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-0 lg:pt-7">
          <EmptyState
            variant="error"
            title={t('common.error')}
            description={data.bootstrapError}
            cta={
              <button
                type="button"
                onClick={data.refresh}
                className="px-5 py-2.5 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110"
              >
                {t('common.retry')}
              </button>
            }
          />
        </div>
      );
    }
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
        <SkeletonBoard />
      </div>
    );
  }

  /* Proyecto inexistente (borrado o id erróneo) → volver a Todo */
  if (!isTodo && !project) {
    return <Navigate to="/" replace />;
  }

  /* ---------- Render ---------- */

  // ¿Puede el usuario gestionar este proyecto (editar/borrar/miembros)?
  const canManage =
    isTodo || project!.owner_id == null || project!.owner_id === me.id || me.role === 'admin';

  const scopes: Array<{ id: 'all' | 'mine' | 'others'; label: string }> = [
    { id: 'all', label: t('board.scopeAll') },
    { id: 'mine', label: t('board.scopeMine') },
    { id: 'others', label: t('board.scopeOthers') },
  ];

  return (
    <div className="touch-pan-y min-h-[calc(100dvh-152px)] lg:min-h-0 lg:touch-auto">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
        {!isTodo && project && canManage && (
          <div className="flex justify-end mb-3">
            <button
              type="button"
              onClick={() => setProjectActionsOpen(true)}
              aria-label={t('projects.actions', { name: project.name })}
              title={t('projects.actions', { name: project.name })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-app bg-surface text-muted hover:text-text"
            >
              <Settings2 className="w-4.5 h-4.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Móvil: alcance + filtros (botón detrás) en la misma horizontal */}
        <div className="mb-1.5 flex items-center gap-2">
          <div
            role="tablist"
            aria-label={t('board.scopeAria')}
            className="inline-flex items-center gap-1 rounded-full bg-surface2 p-1"
          >
            {scopes.map((s) => {
              const active = scope === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScope(s.id)}
                  className={`rounded-full px-3.5 h-9 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    active ? 'bg-surface shadow-soft text-text' : 'text-muted hover:text-text'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={recurringOnly}
            onClick={() => setRecurringOnly((v) => !v)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${
              recurringOnly
                ? 'bg-brand/10 text-brand shadow-soft'
                : 'text-muted hover:text-text bg-surface2'
            }`}
          >
            <Repeat className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('board.recurringOnly')}</span>
          </button>
          {isTodo && (
            <FiltersToggleButton
              activeCount={filtersOpen ? 0 : activeFilterCount}
              open={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
            />
          )}
          <button
            type="button"
            onClick={() => openNewTask({ projectId: isTodo ? undefined : view, column: 'nuevo' })}
            className="ml-auto hidden lg:inline-flex items-center gap-2 rounded-2xl bg-brand text-brandfg px-5 py-2.5 text-[14px] font-semibold hover:brightness-110 shadow-soft"
            aria-label={t('board.newTask')}
          >
            <Plus className="w-5 h-5" aria-hidden="true" />
            {t('board.newTask')}
          </button>
        </div>

        {isTodo && (
          <Filters
            filters={filters}
            onChange={setFilters}
            open={filtersOpen}
            onToggleOpen={() => setFiltersOpen((o) => !o)}
          />
        )}

        {/* ============ SEGMENTED CONTROL MÓVIL: justo sobre las tareas ============ */}
        <div
          data-segbar
          className="lg:hidden mb-1.5"
        >
          <div
            role="tablist"
            aria-label={t('board.statesAria')}
            className="flex items-center gap-1 rounded-full bg-surface2 p-1"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const b = (e.target as HTMLElement).closest<HTMLElement>('[data-seg]');
              if (!b) return;
              e.preventDefault();
              const tabsEl = Array.from(
                (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-seg]'),
              );
              const i = tabsEl.indexOf(b);
              const next =
                tabsEl[(i + (e.key === 'ArrowRight' ? 1 : tabsEl.length - 1)) % tabsEl.length];
              setSeg(next.dataset.seg as ColumnId);
              next.focus();
            }}
          >
            {COLUMNS.map((c) => {
              const n = byColumn.get(c.id)?.length ?? 0;
              const active = seg === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  data-seg={c.id}
                  aria-selected={active}
                  aria-label={t('board.segAria', { column: t(`columns.${c.id}`), count: n })}
                  onClick={() => setSeg(c.id)}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-full px-2 h-11 text-[13px] font-medium whitespace-nowrap ${
                    active ? 'bg-surface shadow-soft' : 'text-muted'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${colorOf(c.color).dot}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{t(`columns.${c.id}`)}</span>
                  <span className={`tnum text-[12px] ${active ? 'text-muted' : 'text-faint'}`}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Track móvil (<lg): las 3 etapas montadas una al lado de otra; el
            drag de tarjeta lo desplaza con transform (efecto escritorio). */}
        <div className="lg:hidden overflow-hidden" aria-live="polite" aria-label={t('board.listAria')}>
          <div ref={mobileTrackRef} className="flex items-start will-change-transform">
            {COLUMNS.map((c) => (
              <div key={c.id} className="w-full shrink-0 space-y-3 pb-4" data-mobile-stage={c.id}>
                {(byColumn.get(c.id) ?? []).map((tk, i) => (
                  <MobileMoveCard
                    key={tk.id}
                    id={tk.id}
                    current={tk.column}
                    steps={COLUMNS.map((col) => col.id)}
                    onMove={doMoveMobile}
                    trackRef={mobileTrackRef}
                  >
                    <TaskCardMobile
                      task={tk}
                      project={data.getProject(tk.project_id)}
                      index={i}
                      onOpen={(id) => openTask(id)}
                      onArchive={c.id === 'hecho' ? doArchive : undefined}
                    />
                  </MobileMoveCard>
                ))}
                {(byColumn.get(c.id) ?? []).length === 0 && (
                  <p className="rounded-2xl border border-dashed border-app px-4 py-8 text-center text-[15px] text-muted">
                    {t('board.emptyState', { column: t(`columns.${c.id}`) })}
                  </p>
                )}
                {c.id === 'hecho' && archivedList.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowArchived((o) => !o)}
                      aria-expanded={showArchived}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-faint hover:text-muted"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          showArchived ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                      {showArchived
                        ? t('board.hideArchived')
                        : t('board.showArchived', { count: archivedList.length })}
                    </button>
                    {showArchived && (
                      <div className="mt-2 space-y-3" aria-label={t('board.archivedListAria')}>
                        {archivedList.map((tk, i) => (
                          <TaskCardMobile
                            key={tk.id}
                            task={tk}
                            project={data.getProject(tk.project_id)}
                            index={i}
                            onOpen={(id) => openTask(id)}
                            archived
                            onUnarchive={doUnarchive}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tablero escritorio (lg+): kanban 3 columnas con drag & drop */}
        <div
          ref={boardRef}
          className="hidden lg:grid lg:grid-cols-3 lg:items-start gap-4"
          aria-live="polite"
          onDragStart={dnd.onDragStart}
          onDragOver={dnd.onDragOver}
          onDrop={dnd.onDrop}
          onDragEnd={dnd.onDragEnd}
        >
          {COLUMNS.map((col) => {
            const list = byColumn.get(col.id) ?? [];
            return (
              <section
                key={col.id}
                data-col={col.id}
                style={
                  {
                    '--accent': COLUMN_ACCENT_RGB[col.color] ?? '148 163 184',
                  } as React.CSSProperties
                }
                className="flex flex-col"
                aria-label={t('board.columnAria', { column: t(`columns.${col.id}`) })}
              >
                <header className="flex items-center gap-2 px-1 pb-3">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${colorOf(col.color).dot}`}
                    aria-hidden="true"
                  />
                  <h2 className="font-display font-semibold text-sm">{t(`columns.${col.id}`)}</h2>
                  <span className="tnum font-display text-xs text-faint" data-count>
                    {list.length}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      openNewTask({ projectId: isTodo ? undefined : view, column: col.id })
                    }
                    className="ml-auto w-7 h-7 rounded-lg text-faint hover:bg-surface2 hover:text-muted flex items-center justify-center"
                    aria-label={t('board.addToColumn', { column: t(`columns.${col.id}`) })}
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                  </button>
                </header>
                <div
                  data-list
                  className="flex-1 space-y-3 overflow-y-auto nice-scroll max-h-[calc(100vh-215px)] pr-1.5 pb-1"
                >
                  {list.map((tk, i) => (
                    <TaskCard
                      key={tk.id}
                      task={tk}
                      project={isTodo ? data.getProject(tk.project_id) : undefined}
                      index={i}
                      onOpen={(id) => openTask(id)}
                      onArchive={col.id === 'hecho' ? doArchive : undefined}
                    />
                  ))}
                  {list.length === 0 && (
                    <p
                      data-empty
                      className="rounded-2xl border border-dashed border-app px-4 py-6 text-center text-sm text-muted"
                    >
                      {t('board.emptyColumn')}
                    </p>
                  )}
                </div>

                {/* Archivadas bajo la columna Hecho: ocultas por defecto */}
                {col.id === 'hecho' && archivedList.length > 0 && (
                  <div className="mt-2 px-1">
                    <button
                      type="button"
                      onClick={() => setShowArchived((o) => !o)}
                      aria-expanded={showArchived}
                      aria-controls="archived-list"
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-faint hover:text-muted hover:bg-surface2"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${
                          showArchived ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                      {showArchived
                        ? t('board.hideArchived')
                        : t('board.showArchived', { count: archivedList.length })}
                    </button>
                    {showArchived && (
                      <div
                        id="archived-list"
                        className="mt-2 space-y-3"
                        aria-label={t('board.archivedListAria')}
                      >
                        {archivedList.map((tk, i) => (
                          <TaskCard
                            key={tk.id}
                            task={tk}
                            project={isTodo ? data.getProject(tk.project_id) : undefined}
                            index={i}
                            onOpen={(id) => openTask(id)}
                            archived
                            onUnarchive={doUnarchive}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pb-4">
        <p className="text-sm text-muted">{t('board.openTasks', { count: openCount })}</p>
      </div>

      {/* FAB móvil: nueva tarea */}
      <button
        type="button"
        onClick={() => openNewTask({ projectId: isTodo ? undefined : view, column: seg })}
        className="lg:hidden fixed right-4 z-40 w-14 h-14 rounded-2xl bg-brand text-brandfg shadow-lg flex items-center justify-center hover:brightness-110"
        style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
        aria-label={t('board.newTask')}
      >
        <Plus className="w-6 h-6" aria-hidden="true" />
      </button>

      {projectActionsOpen && project && (
        <ProjectActions project={project} onClose={() => setProjectActionsOpen(false)} />
      )}
    </div>
  );
}
