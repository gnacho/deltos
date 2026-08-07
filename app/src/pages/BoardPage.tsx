import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useParams, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Menu, Plus } from 'lucide-react';
import type { ColumnId, Task } from '@/data/types';
import { useData } from '@/data/data-context';
import { useTaskModal } from '@/components/modal-context';
import { TaskCard, TaskCardMobile } from '@/components/TaskCard';
import { Filters } from '@/components/Filters';
import { emptyFilters, type FilterState } from '@/components/filters-state';
import { COLUMNS } from '@/lib/constants';
import { colorOf, COLUMN_ACCENT_RGB } from '@/lib/colors';
import { announce } from '@/lib/announce';
import { ProjectActions } from '@/components/ProjectActions';

const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

export default function BoardPage() {
  const { t } = useTranslation();
  const data = useData();
  const { openTask, openNewTask } = useTaskModal();
  const { projectId } = useParams<{ projectId: string }>();
  const view = projectId ?? 'todo';
  const isTodo = view === 'todo';

  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [seg, setSeg] = useState<ColumnId>('nuevo');
  const [projectActionsOpen, setProjectActionsOpen] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const placeholder = useRef<HTMLDivElement | null>(null);
  const flipRects = useRef<Map<string, DOMRect> | null>(null);

  const tasks = data.getTasks();
  const project = isTodo ? undefined : data.getProject(view);

  /* Tareas visibles según vista + filtros */
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
    return list;
  }, [tasks, isTodo, view, filters]);

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

  /* FLIP: tras un cambio de datos provocado por DnD, animar desde la posición anterior */
  useLayoutEffect(() => {
    const before = flipRects.current;
    if (!before) return;
    flipRects.current = null;
    if (reducedMotionMQ.matches || !boardRef.current) return;
    boardRef.current.querySelectorAll<HTMLElement>('[data-task]').forEach((el) => {
      const old = before.get(el.dataset.task ?? '');
      if (!old) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px,${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform .28s ease';
        el.style.transform = '';
        el.addEventListener('transitionend', () => (el.style.transition = ''), { once: true });
      });
    });
  }, [tasks]);

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

  /* ---------- DnD (HTML5, delegado como en el mockup) ---------- */

  const cleanupDrag = () => {
    dragId.current = null;
    if (placeholder.current) {
      placeholder.current.remove();
      placeholder.current = null;
    }
    boardRef.current
      ?.querySelectorAll('.col-target')
      .forEach((s) => s.classList.remove('col-target'));
    boardRef.current?.querySelectorAll('.dragging').forEach((c) => c.classList.remove('dragging'));
    boardRef.current?.querySelectorAll<HTMLElement>('[data-empty]').forEach((p) => {
      p.style.display = '';
    });
  };

  const onDragStart = (e: DragEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-task]');
    if (!card) return;
    dragId.current = card.dataset.task ?? null;
    e.dataTransfer.setData('text/plain', dragId.current ?? '');
    e.dataTransfer.effectAllowed = 'move';
    const ph = document.createElement('div');
    ph.className = 'drop-placeholder';
    ph.style.height = `${card.offsetHeight}px`;
    ph.setAttribute('aria-hidden', 'true');
    placeholder.current = ph;
    window.setTimeout(
      () => card.classList.add('dragging'),
      0,
    ); /* no ensuciar la imagen de arrastre */
  };

  const onDragOver = (e: DragEvent) => {
    if (!dragId.current) return;
    const section = (e.target as HTMLElement).closest<HTMLElement>('section[data-col]');
    if (!section) return;
    e.preventDefault(); /* necesario para permitir el drop */
    e.dataTransfer.dropEffect = 'move';
    boardRef.current?.querySelectorAll('.col-target').forEach((s) => {
      if (s !== section) s.classList.remove('col-target');
    });
    section.classList.add('col-target');
    const list = section.querySelector('[data-list]');
    if (!list || !placeholder.current) return;
    /* Inserción: antes de la primera tarjeta cuyo centro vertical queda por debajo del cursor */
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-task]')).filter(
      (c) => c.dataset.task !== dragId.current,
    );
    let ref: HTMLElement | null = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        ref = c;
        break;
      }
    }
    const empty = list.querySelector<HTMLElement>('[data-empty]');
    if (empty) empty.style.display = 'none';
    if (ref) list.insertBefore(placeholder.current, ref);
    else list.appendChild(placeholder.current);
  };

  const onDrop = (e: DragEvent) => {
    if (!dragId.current) return;
    e.preventDefault();
    const section = (e.target as HTMLElement).closest<HTMLElement>('section[data-col]');
    if (!section) {
      cleanupDrag();
      return;
    }
    /* La tarjeta que sigue al placeholder = referencia de inserción */
    let refId: string | null = null;
    if (placeholder.current?.parentElement) {
      let n = placeholder.current.nextElementSibling as HTMLElement | null;
      while (n) {
        if (n.dataset?.task) {
          refId = n.dataset.task;
          break;
        }
        n = n.nextElementSibling as HTMLElement | null;
      }
    }
    const id = dragId.current;
    const toCol = section.dataset.col as ColumnId;
    cleanupDrag();
    void doMove(id, toCol, refId);
  };

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

    /* FLIP: capturar posiciones antes de la mutación */
    if (!reducedMotionMQ.matches && boardRef.current) {
      const map = new Map<string, DOMRect>();
      boardRef.current.querySelectorAll<HTMLElement>('[data-task]').forEach((el) => {
        map.set(el.dataset.task ?? '', el.getBoundingClientRect());
      });
      flipRects.current = map;
    }

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

  /* ---------- Render ---------- */

  const title = isTodo ? t('nav.todo') : `${project!.emoji} ${project!.name}`;
  const subtitle = isTodo ? t('board.todoSubtitle') : t('board.projectSubtitle');

  return (
    <div className="pt-[52px] lg:pt-0">
      {/* ============ SEGMENTED CONTROL MÓVIL ============ */}
      <div
        className="lg:hidden fixed top-14 inset-x-0 z-30 border-b border-app px-4 py-2.5"
        style={{ backgroundColor: 'var(--bg)' }}
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

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
        {/* Cabecera de vista */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
              {title}
            </h1>
            <p className="text-sm text-muted mt-0.5">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {!isTodo && project && (
              <button
                type="button"
                onClick={() => setProjectActionsOpen(true)}
                aria-label={t('projects.actions', { name: project.name })}
                title={t('projects.actions', { name: project.name })}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-app bg-surface text-muted hover:text-text"
              >
                <Menu className="w-4.5 h-4.5" aria-hidden="true" />
              </button>
            )}
            <p className="tnum text-sm text-muted">{t('board.openTasks', { count: openCount })}</p>
          </div>
        </div>

        {isTodo && <Filters filters={filters} onChange={setFilters} />}

        {/* Lista móvil (<lg): un solo estado, tarjetas simplificadas */}
        <div
          className="lg:hidden space-y-3 pb-4"
          aria-live="polite"
          aria-label={t('board.listAria')}
        >
          {(byColumn.get(seg) ?? []).map((tk, i) => (
            <TaskCardMobile
              key={tk.id}
              task={tk}
              project={data.getProject(tk.project_id)}
              index={i}
              onOpen={(id) => openTask(id)}
            />
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
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={cleanupDrag}
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
