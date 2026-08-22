import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X, User, ChevronDown } from 'lucide-react';
import { z } from 'zod';
import type { ColumnId, Priority } from '@/data/types';
import { useData } from '@/data/data-context';
import type { NewTaskDefaults } from '@/components/modal-context';
import { COLUMNS, PRIORITIES, PRIORITY_BADGE } from '@/lib/constants';
import { colorOf } from '@/lib/colors';
import { ProjectIcon } from '@/components/ProjectIcon';
import { apiErrorText } from '@/lib/errors';
import { Avatar } from '@/components/Avatar';
import { ArrowUp, ArrowRight, ArrowDown } from 'lucide-react';
import { RecurrenceField } from '@/components/task/RecurrenceField';
import type { TaskRecurrence } from '@/data/types';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  project_id: z.string().min(1),
});

const PR_ICON = { alta: ArrowUp, media: ArrowRight, baja: ArrowDown } as const;

/** Modal de creación de tarea (botón + por columna en desktop, FAB en móvil). */
export function NewTaskModal({
  defaults,
  onClose,
}: {
  defaults: NewTaskDefaults;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const projects = data.getProjects();
  const labels = data.getLabels();

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(defaults.projectId ?? projects[0]?.id ?? '');
  // El asignable se restringe a miembros del proyecto elegido (los demás no
  // verían la tarea); fallback a todos los usuarios si no hay membresía.
  const users = projects.find((p) => p.id === projectId)?.members ?? data.getUsers();
  const [column, setColumn] = useState<ColumnId>(defaults.column ?? 'nuevo');
  const [priority, setPriority] = useState<Priority | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    lastFocus.current = document.activeElement;
    titleRef.current?.focus();
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      const el = lastFocus.current;
      if (el instanceof HTMLElement) el.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ title, project_id: projectId });
    if (!parsed.success) {
      setError(t('newTask.titleRequired'));
      return;
    }
    setCreating(true);
    try {
      await data.createTask({
        project_id: parsed.data.project_id,
        title: parsed.data.title,
        column,
        priority,
        due_date: dueDate || null,
        assignee_id: assigneeId,
        labels: [...labelIds],
        recurrence,
      });
      onClose();
    } catch (err) {
      setError(apiErrorText(err, t('newTask.error')));
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-task-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <form
        onSubmit={submit}
        noValidate
        className="relative w-full sm:max-w-lg bg-surface rounded-t-2xl sm:rounded-2xl border border-app shadow-2xl max-h-[92vh] overflow-y-auto nice-scroll"
      >
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-app px-5 py-4 flex items-center gap-3">
          <h2
            id="new-task-title"
            className="font-display font-bold text-[18px] tracking-tight flex-1"
          >
            {t('newTask.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <div>
            <label
              htmlFor="nt-title"
              className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
            >
              {t('newTask.titleLabel')}
            </label>
            <input
              ref={titleRef}
              id="nt-title"
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('newTask.titlePlaceholder')}
              className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand"
            />
          </div>

          <div>
            <label
              htmlFor="nt-project"
              className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
            >
              {t('newTask.project')}
            </label>
            <div className="relative">
              <button
                type="button"
                id="nt-project"
                aria-haspopup="listbox"
                aria-expanded={projectOpen}
                onClick={() => setProjectOpen((o) => !o)}
                className="w-full inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand"
              >
                <ProjectIcon name={projects.find((p) => p.id === projectId)?.emoji ?? 'home'} className="w-4.5 h-4.5 text-muted shrink-0" />
                <span className="flex-1 text-left truncate">
                  {projects.find((p) => p.id === projectId)?.name ?? ''}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-faint shrink-0 transition-transform duration-200 ${projectOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {projectOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setProjectOpen(false)} aria-hidden="true" />
                  <ul
                    role="listbox"
                    aria-label={t('newTask.project')}
                    className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
                  >
                    {projects.map((p) => {
                      const active = p.id === projectId;
                      return (
                        <li key={p.id} role="option" aria-selected={active}>
                          <button
                            type="button"
                            onClick={() => {
                              setProjectId(p.id);
                              setProjectOpen(false);
                            }}
                            className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                              active ? 'font-medium text-brand' : ''
                            }`}
                          >
                            <ProjectIcon name={p.emoji} className="w-4 h-4 shrink-0" />
                            <span className="flex-1 truncate">{p.name}</span>
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
            <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
              {t('newTask.column')}
            </p>
            <div
              className="flex gap-1 rounded-full bg-surface2 p-1"
              role="group"
              aria-label={t('newTask.column')}
            >
              {COLUMNS.map((c) => {
                const active = column === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setColumn(c.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-full px-2 h-10 text-[13px] font-medium ${
                      active ? 'bg-surface shadow-soft' : 'text-muted'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${colorOf(c.color).dot}`}
                      aria-hidden="true"
                    />
                    {t(`columns.${c.id}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
                {t('task.priority')}
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.priority')}>
                {PRIORITIES.map((pr) => {
                  const Icon = PR_ICON[pr];
                  const active = priority === pr;
                  return (
                    <button
                      key={pr}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPriority(active ? null : pr)}
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
              </div>
            </div>
            <div>
              <label
                htmlFor="nt-due"
                className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
              >
                {t('task.dueDate')}
              </label>
              <input
                id="nt-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-surface2 border border-app rounded-xl px-3 py-2 text-[14px] outline-none focus:border-brand"
              />
            </div>
          </div>

          <RecurrenceField
            value={recurrence}
            onChange={setRecurrence}
            idPrefix="nt"
          />

          <div>
            <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
              {t('task.assignee')}
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.assignee')}>
              {users.map((u) => {
                const active = assigneeId === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setAssigneeId(active ? null : u.id)}
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
              {users.length === 0 && (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-faint">
                  <User className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('filters.unassigned')}
                </span>
              )}
            </div>
          </div>

          {labels.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
                {t('task.labels')}
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.labels')}>
                {labels.map((l) => {
                  const active = labelIds.has(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const next = new Set(labelIds);
                        if (active) next.delete(l.id);
                        else next.add(l.id);
                        setLabelIds(next);
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
            </div>
          )}

          {error && (
            <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={creating || projects.length === 0}
            className="w-full h-12 rounded-xl bg-brand text-brandfg text-[15px] font-semibold hover:brightness-110 disabled:opacity-60 shadow-soft"
          >
            {creating ? t('newTask.creating') : t('newTask.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
