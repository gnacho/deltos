import { useMemo, useRef, useState } from 'react';
import { useParams, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Plus, Settings2 } from 'lucide-react';
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
  const [projectActionsOpen, setProjectActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeFilterCount =
    filters.projects.size + filters.people.size + filters.priorities.size + filters.tags.size;

  const boardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const tasks = data.getTasks();
  const project = isTodo ? undefined : data.getProject(view);

  /* Tareas visibles según vista + filtros + alcance (todas/mías/de otras) */
  const visible = useMemo(() => {
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
    return list;
  }, [tasks, isTodo, view, filters, scope, me.id]);

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
    if (!task) return;
    /* Posición = índice en la columna completa (sin filtros), excluyendo la arrastrada */
    const colTasks = tasks
      .filter((tk) => tk.column === toCol && tk.id !== id)
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
    } catch {
      announce(t('common.error'));
    }
  };

  const dnd = useKanbanDnD<ColumnId>({
    boardRef,
    items: tasks,
    onMove: (id, toCol, refId) => void doMove(id, toCol, refId),
  });

  const doMoveMobile = (id: string, toCol: string) => {
    void doMove(id, toCol as ColumnId, null);
  };

  useStepSwipe<ColumnId>(listRef, COLUMNS.map((c) => c.id), seg, setSeg, data.ready);

  if (!data.ready) {
    if (data.bootstrapError) {
      return (
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
          <div className="rounded-2xl bg-surface border border-app shadow-soft p-8 text-center max-w-md mx-auto">
            <p className="text-[15px] font-medium mb-1">{t('common.error')}</p>
            <p className="text-sm text-muted mb-4">{data.bootstrapError}</p>
            <button
              type="button"
              onClick={data.refresh}
              className="px-5 py-2.5 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110"
            >
              {t('common.retry')}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7" role="status">
        <div className="animate-pulse space-y-3">
          <div className="h-8 w-48 rounded-lg bg-surface2" />
          <div className="grid lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-surface2" />
            ))}
          </div>
        </div>
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
    <div>
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
        <div className="mb-4 flex items-center gap-2">
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
          className="lg:hidden mb-3"
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

        {/* Lista móvil (<lg): un solo estado, tarjetas simplificadas */}
        <div
          ref={listRef}
          className="lg:hidden space-y-3 pb-4"
          aria-live="polite"
          aria-label={t('board.listAria')}
          style={{ touchAction: 'pan-y' }}
        >
          {(byColumn.get(seg) ?? []).map((tk, i) => (
            <MobileMoveCard
              key={tk.id}
              id={tk.id}
              current={tk.column}
              steps={COLUMNS.map((c) => c.id)}
              onMove={doMoveMobile}
            >
              <TaskCardMobile
                task={tk}
                project={data.getProject(tk.project_id)}
                index={i}
                onOpen={(id) => openTask(id)}
              />
            </MobileMoveCard>
          ))}
          {(byColumn.get(seg) ?? []).length === 0 && (
            <p className="rounded-2xl border border-dashed border-app px-4 py-8 text-center text-[15px] text-muted">
              {t('board.emptyState', { column: t(`columns.${seg}`) })}
            </p>
          )}
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
