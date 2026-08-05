import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { Task, TaskDetail } from '@/data/types';
import { useData } from '@/data/data-context';
import { COLUMNS, PRIORITIES, PRIORITY_BADGE } from '@/lib/constants';
import { colorOf } from '@/lib/colors';
import { Avatar } from '@/components/Avatar';
import { announce } from '@/lib/announce';
import { ArrowUp, ArrowRight, ArrowDown, ChevronDown, User } from 'lucide-react';

const titleSchema = z.string().trim().min(1).max(200);

const PR_ICON = { alta: ArrowUp, media: ArrowRight, baja: ArrowDown } as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
      {children}
    </p>
  );
}

/** Pestaña Detalles: edición real de la tarea (PATCH) + mover + borrar. */
export function DetailsTab({ detail, onClose }: { detail: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const data = useData();
  const task: Task = detail.task;

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const deleteTimer = useRef<number | null>(null);

  /* Sincroniza campos si la tarea cambia por SSE/refresco */
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);
  useEffect(
    () => () => {
      if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    },
    [],
  );

  const patch = async (p: Parameters<typeof data.patchTask>[1]) => {
    try {
      await data.patchTask(task.id, p);
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      setSaveState('error');
    }
  };

  const saveTitle = () => {
    const parsed = titleSchema.safeParse(title);
    if (!parsed.success) {
      setTitleError(t('newTask.titleRequired'));
      setTitle(task.title);
      return;
    }
    setTitleError(null);
    if (parsed.data !== task.title) void patch({ title: parsed.data });
  };

  const saveDescription = () => {
    if (description !== task.description) void patch({ description });
  };

  const onDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      announce(t('task.deleteConfirm'));
      deleteTimer.current = window.setTimeout(() => setDeleteArmed(false), 4000);
      return;
    }
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    setDeleting(true);
    try {
      await data.deleteTask(task.id);
      onClose();
    } catch {
      setDeleting(false);
      setDeleteArmed(false);
      setSaveState('error');
    }
  };

  const users = data.getUsers();
  const labels = data.getLabels();
  const projects = data.getProjects();
  const project = data.getProject(task.project_id);
  const taskLabelIds = new Set(task.labels.map((l) => l.id));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <div className="col-span-2">
          <FieldLabel>{t('task.titleLabel')}</FieldLabel>
          <input
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            aria-invalid={titleError !== null}
            className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand"
          />
          {titleError && (
            <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400 mt-1">
              {titleError}
            </p>
          )}
        </div>
      </div>

      <section>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('task.moveToGroup')}>
          {COLUMNS.map((c) => {
            const current = task.column === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={current}
                aria-pressed={current}
                aria-label={
                  current
                    ? t('task.moveToCurrentAria', { column: t(`columns.${c.id}`) })
                    : t('task.moveToAria', { column: t(`columns.${c.id}`) })
                }
                onClick={() => {
                  const position = data
                    .getTasks()
                    .filter((tk) => tk.column === c.id && tk.id !== task.id).length;
                  void data
                    .moveTask(task.id, c.id, position)
                    .then(() =>
                      announce(
                        t('board.movedTo', { title: task.title, column: t(`columns.${c.id}`) }),
                      ),
                    )
                    .catch(() => setSaveState('error'));
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium ${
                  current
                    ? `${colorOf(c.color).chip} ring-1 ring-current cursor-default`
                    : 'bg-surface border border-app text-muted hover:bg-surface2'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${colorOf(c.color).dot}`}
                  aria-hidden="true"
                />
                {t(`columns.${c.id}`)}
                {current ? ` · ${t('task.current')}` : ''}
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <div className="col-span-2">
          <FieldLabel>{t('task.project')}</FieldLabel>
          <div className="relative">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={projectOpen}
              onClick={() => setProjectOpen((o) => !o)}
              className="w-full inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[14px] font-medium outline-none focus:border-brand"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${project ? colorOf(project.color).dot : 'bg-faint/40'}`}
                aria-hidden="true"
              />
              <span className="flex-1 text-left">{project?.name ?? t('task.noProject')}</span>
              <ChevronDown
                className={`w-4 h-4 text-faint transition-transform duration-200 ${projectOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            {projectOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setProjectOpen(false)} aria-hidden="true" />
                <ul
                  role="listbox"
                  aria-label={t('task.project')}
                  className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
                >
                  {projects.map((p) => {
                    const active = p.id === task.project_id;
                    return (
                      <li key={p.id} role="option" aria-selected={active}>
                        <button
                          type="button"
                          onClick={() => {
                            setProjectOpen(false);
                            if (!active) void patch({ project_id: p.id });
                          }}
                          className={`w-full flex items-center gap-2 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                            active ? 'font-medium text-brand' : ''
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${colorOf(p.color).dot}`}
                            aria-hidden="true"
                          />
                          <span className="flex-1">{p.name}</span>
                          {active && (
                            <span className="text-[12px] font-semibold">{t('task.current')}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>

        <div>
          <FieldLabel>{t('task.assignee')}</FieldLabel>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.assignee')}>
            {users.map((u) => {
              const active = task.assignee_id === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => void patch({ assignee_id: active ? null : u.id })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                    active
                      ? `${colorOf(u.color).chip} ring-1 ring-current font-medium`
                      : 'bg-surface border border-app text-muted hover:bg-surface2'
                  }`}
                >
                  <Avatar name={u.username} color={u.color} />
                  {u.username}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={task.assignee_id === null}
              onClick={() => void patch({ assignee_id: null })}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                task.assignee_id === null
                  ? 'bg-slate-200/70 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300 ring-1 ring-current font-medium'
                  : 'bg-surface border border-app text-muted hover:bg-surface2'
              }`}
            >
              <User className="w-3 h-3" aria-hidden="true" />
              {t('filters.unassigned')}
            </button>
          </div>
        </div>

        <div>
          <FieldLabel>{t('task.priority')}</FieldLabel>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.priority')}>
            {PRIORITIES.map((pr) => {
              const Icon = PR_ICON[pr];
              const active = task.priority === pr;
              return (
                <button
                  key={pr}
                  type="button"
                  aria-pressed={active}
                  onClick={() => void patch({ priority: active ? null : pr })}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ${
                    active
                      ? `${PRIORITY_BADGE[pr]} ring-1 ring-current font-medium`
                      : 'bg-surface border border-app text-muted hover:bg-surface2'
                  }`}
                >
                  <Icon className="w-3 h-3" aria-hidden="true" />
                  {t(`priority.${pr}`)}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={task.priority === null}
              onClick={() => void patch({ priority: null })}
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs ${
                task.priority === null
                  ? 'bg-slate-200/70 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300 ring-1 ring-current font-medium'
                  : 'bg-surface border border-app text-muted hover:bg-surface2'
              }`}
            >
              {t('priority.none')}
            </button>
          </div>
        </div>

        <div>
          <FieldLabel>{t('task.dueDate')}</FieldLabel>
          <input
            type="date"
            value={task.due_date ?? ''}
            onChange={(e) => void patch({ due_date: e.target.value || null })}
            className="w-full bg-surface2 border border-app rounded-xl px-3 py-2 text-[14px] outline-none focus:border-brand"
          />
        </div>

        <div className="col-span-2">
          <FieldLabel>{t('task.labels')}</FieldLabel>
          {labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.labels')}>
              {labels.map((l) => {
                const active = taskLabelIds.has(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = active
                        ? task.labels.filter((x) => x.id !== l.id).map((x) => x.id)
                        : [...task.labels.map((x) => x.id), l.id];
                      void patch({ labels: next });
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs ${
                      active
                        ? `${colorOf(l.color).chip} ring-1 ring-current font-medium`
                        : 'bg-surface border border-app text-muted hover:bg-surface2'
                    }`}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="text-[14px] text-faint">{t('task.noLabels')}</span>
          )}
        </div>
      </div>

      <section>
        <h3 className="font-display font-semibold text-[14px] mb-2">{t('task.description')}</h3>
        <textarea
          value={description}
          maxLength={5000}
          rows={4}
          placeholder={t('task.descriptionPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] leading-relaxed outline-none focus:border-brand resize-y"
        />
      </section>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-app">
        <p className="text-[12px] text-faint" role="status" aria-live="polite">
          {saveState === 'saved' && (
            <span className="inline-flex items-center gap-1 text-ok">
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              {t('task.saved')}
            </span>
          )}
          {saveState === 'error' && (
            <span className="text-rose-600 dark:text-rose-400">{t('task.saveError')}</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => void onDelete()}
          disabled={deleting}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium ${
            deleteArmed
              ? 'bg-rose-600 text-white hover:bg-rose-700'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 hover:bg-rose-200/70 dark:hover:bg-rose-500/25'
          } disabled:opacity-60`}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          {deleting
            ? t('task.deleting')
            : deleteArmed
              ? t('task.deleteConfirm')
              : t('task.deleteTitle')}
        </button>
      </div>
      {deleteArmed && <p className="text-[12px] text-faint -mt-4">{t('task.deleteHint')}</p>}
    </div>
  );
}
