import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { X, Wand2 } from 'lucide-react';
import { z } from 'zod';
import type { ColumnId, Priority } from '@/data/types';
import { useData } from '@/data/data-context';
import type { NewTaskDefaults } from '@/components/modal-context';
import { COLUMNS } from '@/lib/constants';
import { colorOf } from '@/lib/colors';
import { inboxProject } from '@/lib/projects';
import { apiErrorText } from '@/lib/errors';
import { TaskFields, type TaskFieldsValue } from '@/components/task/TaskFields';
import { DraftSubtaskList } from '@/components/task/DraftSubtaskList';
import type { TaskRecurrence } from '@/data/types';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  project_id: z.string().min(1),
});

/** Modal de creación de tarea (botón + por columna en desktop, FAB en móvil).
 *  Comparte el formulario TaskFields con la pestaña Detalles para que crear y
 *  editar ofrezcan los mismos campos. */
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
  const inbox = inboxProject(projects);

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(
    defaults.projectId ?? inbox?.id ?? projects[0]?.id ?? '',
  );
  // El asignable se restringe a miembros del proyecto elegido (los demás no
  // verían la tarea); fallback a todos los usuarios si no hay membresía.
  const users = projects.find((p) => p.id === projectId)?.members ?? data.getUsers();
  const [column, setColumn] = useState<ColumnId>(defaults.column ?? 'nuevo');
  const [priority, setPriority] = useState<Priority | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [suggested, setSuggested] = useState<{
    due_date?: string | null;
    recurrence?: TaskRecurrence | null;
    cleanedTitle?: string;
  } | null>(null);
  const lang: 'es' | 'en' = i18n.language?.startsWith('en') ? 'en' : 'es';

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

  // Parseo automático del título en lenguaje natural (debounce). Solo sugiere
  // cuando el usuario aún no ha fijado due_date/recurrence a mano.
  useEffect(() => {
    if (!title.trim() || dueDate || recurrence) {
      setSuggested(null);
      return;
    }
    setParsing(true);
    const id = window.setTimeout(async () => {
      try {
        const res = await data.parseTaskText(title.trim(), lang);
        setSuggested(res.parsed && res.cleanedTitle ? res : null);
      } catch {
        setSuggested(null);
      } finally {
        setParsing(false);
      }
    }, 450);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, dueDate, recurrence, lang]);

  const value: TaskFieldsValue = {
    title,
    description,
    project_id: projectId,
    priority,
    assignee_id: assigneeId,
    due_date: dueDate,
    recurrence,
    labelIds,
  };

  const onFieldsChange = (p: Partial<TaskFieldsValue>) => {
    if (p.title !== undefined) setTitle(p.title);
    if (p.description !== undefined) setDescription(p.description);
    if (p.project_id !== undefined) setProjectId(p.project_id);
    if (p.priority !== undefined) setPriority(p.priority);
    if (p.assignee_id !== undefined) setAssigneeId(p.assignee_id);
    if (p.due_date !== undefined) setDueDate(p.due_date);
    if (p.recurrence !== undefined) setRecurrence(p.recurrence);
    if (p.labelIds !== undefined) setLabelIds(p.labelIds);
  };

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
        description,
        column,
        priority,
        due_date: dueDate || null,
        assignee_id: assigneeId,
        labels: labelIds,
        recurrence,
        subtasks,
      });
      onClose();
    } catch (err) {
      setError(apiErrorText(err, t('newTask.error')));
      setCreating(false);
    }
  };

  const titleExtra = (
    <>
      {parsing && (
        <p className="text-[12px] text-faint mt-1.5 flex items-center gap-1">
          <Wand2 className="w-3 h-3" aria-hidden="true" />
          {t('newTask.parsing')}
        </p>
      )}
      {!parsing && suggested && !dueDate && !recurrence && (
        <div className="mt-2 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] text-muted leading-snug">
              {t('newTask.suggestion', {
                summary: [
                  suggested.due_date && t('newTask.suggestionDue', { date: suggested.due_date }),
                  suggested.recurrence && t(`task.recurrenceFreq.${suggested.recurrence.freq}`),
                ]
                  .filter(Boolean)
                  .join(' · '),
              })}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTitle(suggested.cleanedTitle ?? title);
                  setDueDate(suggested.due_date ?? null);
                  if (suggested.recurrence) setRecurrence(suggested.recurrence);
                  setSuggested(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-brandfg hover:brightness-110"
              >
                <Wand2 className="w-3 h-3" aria-hidden="true" />
                {t('newTask.applySuggestion')}
              </button>
              <button
                type="button"
                onClick={() => setSuggested(null)}
                aria-label={t('common.close')}
                className="w-7 h-7 rounded-lg text-faint hover:bg-surface2 flex items-center justify-center"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const columnSlot = (
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
              <span className={`w-2 h-2 rounded-full ${colorOf(c.color).dot}`} aria-hidden="true" />
              {t(`columns.${c.id}`)}
            </button>
          );
        })}
      </div>
    </div>
  );

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
        className="relative w-full sm:max-w-lg lg:max-w-2xl xl:max-w-3xl 2xl:max-w-4xl bg-surface rounded-t-2xl sm:rounded-2xl border border-app shadow-2xl max-h-[92vh] overflow-y-auto nice-scroll"
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

        <div className="px-5 py-5">
          <TaskFields
            value={value}
            onChange={onFieldsChange}
            idPrefix="nt"
            projects={projects}
            labels={labels}
            users={users}
            titleInputRef={titleRef}
            titleExtra={titleExtra}
            columnSlot={columnSlot}
            subtasksSlot={<DraftSubtaskList subtasks={subtasks} onChange={setSubtasks} />}
          >
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
          </TaskFields>
        </div>
      </form>
    </div>
  );
}
