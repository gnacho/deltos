import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { z } from 'zod';
import type { Task, TaskDetail, TaskRecurrence } from '@/data/types';
import { useData } from '@/data/data-context';
import { COLUMNS } from '@/lib/constants';
import { colorOf } from '@/lib/colors';
import { announce } from '@/lib/announce';
import { TaskFields, type TaskFieldsValue } from '@/components/task/TaskFields';
import { SubtaskList } from '@/components/task/SubtaskList';

const titleSchema = z.string().trim().min(1).max(200);

/** Pestaña Detalles: edición real de la tarea (PATCH) + mover + borrar.
 *  Usa el mismo formulario que el modal de creación (TaskFields). */
export function DetailsTab({ detail, onClose }: { detail: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const data = useData();
  const task: Task = detail.task;

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(task.recurrence);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteTimer = useRef<number | null>(null);

  /* Sincroniza campos si la tarea cambia por SSE/refresco */
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);
  useEffect(() => setRecurrence(task.recurrence), [task.recurrence]);
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

  const commitTitle = () => {
    const parsed = titleSchema.safeParse(title);
    if (!parsed.success) {
      setTitleError(t('newTask.titleRequired'));
      setTitle(task.title);
      return;
    }
    setTitleError(null);
    if (parsed.data !== task.title) void patch({ title: parsed.data });
  };

  const commitDescription = () => {
    if (description !== task.description) void patch({ description });
  };

  const value: TaskFieldsValue = {
    title,
    description,
    project_id: task.project_id,
    priority: task.priority,
    assignee_id: task.assignee_id,
    due_date: task.due_date,
    recurrence,
    labelIds: task.labels.map((l) => l.id),
  };

  const onFieldsChange = (p: Partial<TaskFieldsValue>) => {
    if (p.title !== undefined) {
      setTitle(p.title);
      return;
    }
    if (p.description !== undefined) {
      setDescription(p.description);
      return;
    }
    if (p.recurrence !== undefined) {
      setRecurrence(p.recurrence);
      void patch({ recurrence: p.recurrence });
      return;
    }
    if (p.labelIds !== undefined) {
      void patch({ labels: p.labelIds });
      return;
    }
    void patch(p);
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

  const users = data.getProject(task.project_id)?.members ?? data.getUsers();
  const labels = data.getLabels();
  const projects = data.getProjects();

  const columnSlot = (
    <section>
      <div className="flex flex-wrap gap-2 items-center" role="group" aria-label={t('task.moveToGroup')}>
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
                  .filter((tk) => !tk.archived_at && tk.column === c.id && tk.id !== task.id).length;
                void data
                  .moveTask(task.id, c.id, position)
                  .then(() =>
                    announce(t('board.movedTo', { title: task.title, column: t(`columns.${c.id}`) })),
                  )
                  .catch(() => setSaveState('error'));
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium ${
                current
                  ? `${colorOf(c.color).chip} ring-1 ring-current cursor-default`
                  : 'bg-surface border border-app text-muted hover:bg-surface2'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${colorOf(c.color).dot}`} aria-hidden="true" />
              {t(`columns.${c.id}`)}
              {current ? ` · ${t('task.current')}` : ''}
            </button>
          );
        })}
        {task.archived_at ? (
          <span className="inline-flex items-center gap-2 ml-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface2 text-muted">
              <Archive className="w-3 h-3" aria-hidden="true" />
              {t('task.archived')}
            </span>
            <button
              type="button"
              onClick={() =>
                void data
                  .unarchiveTask(task.id)
                  .then(() => announce(t('board.taskUnarchived', { title: task.title })))
                  .catch(() => setSaveState('error'))
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium bg-surface border border-app text-muted hover:bg-surface2"
            >
              <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
              {t('task.unarchive')}
            </button>
          </span>
        ) : (
          task.column === 'hecho' && (
            <button
              type="button"
              onClick={() =>
                void data
                  .archiveTask(task.id)
                  .then(() => announce(t('board.taskArchived', { title: task.title })))
                  .catch(() => setSaveState('error'))
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium bg-surface border border-app text-muted hover:bg-surface2"
            >
              <Archive className="w-4 h-4" aria-hidden="true" />
              {t('task.archive')}
            </button>
          )
        )}
      </div>
    </section>
  );

  return (
    <TaskFields
      value={value}
      onChange={onFieldsChange}
      onTextCommit={(field) => (field === 'title' ? commitTitle() : commitDescription())}
      titleError={titleError}
      idPrefix="dt"
      projects={projects}
      labels={labels}
      users={users}
      columnSlot={columnSlot}
      subtasksSlot={<SubtaskList taskId={task.id} subtasks={detail.subtasks ?? []} />}
    >
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
    </TaskFields>
  );
}
