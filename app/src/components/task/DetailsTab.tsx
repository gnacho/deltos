import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, ArchiveRestore } from 'lucide-react';
import type { ColumnId, Task, TaskDetail, TaskRecurrence } from '@/data/types';
import { useData } from '@/data/data-context';
import { announce } from '@/lib/announce';
import { TaskFields, type TaskFieldsValue } from '@/components/task/TaskFields';
import { TaskFooter } from '@/components/task/TaskFooter';
import { StageSelect } from '@/components/task/StageSelect';
import { SubtaskList } from '@/components/task/SubtaskList';
import { useTaskText } from '@/components/task/useTaskText';

/** Pestaña Detalles: edición real de los campos de la tarea (PATCH) + mover +
 *  archivar + borrar. Título y descripción viven en la pestaña Tarea. */
export function DetailsTab({ detail, onClose }: { detail: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const data = useData();
  const task: Task = detail.task;

  const text = useTaskText(task);
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(task.recurrence);

  /* Sincroniza campos si la tarea cambia por SSE/refresco */
  useEffect(() => setRecurrence(task.recurrence), [task.recurrence]);

  const moveTo = (column: ColumnId) => {
    if (column === task.column) return;
    const position = data
      .getTasks()
      .filter((tk) => !tk.archived_at && tk.column === column && tk.id !== task.id).length;
    void data
      .moveTask(task.id, column, position)
      .then(() => announce(t('board.movedTo', { title: task.title, column: t(`columns.${column}`) })))
      .catch(() => text.setSaveState('error'));
  };

  const value: TaskFieldsValue = {
    title: text.title,
    description: text.description,
    project_id: task.project_id,
    priority: task.priority,
    assignee_id: task.assignee_id,
    due_date: task.due_date,
    recurrence,
    labelIds: task.labels.map((l) => l.id),
  };

  const onFieldsChange = (p: Partial<TaskFieldsValue>) => {
    if (p.title !== undefined) {
      text.setTitle(p.title);
      return;
    }
    if (p.description !== undefined) {
      text.setDescription(p.description);
      return;
    }
    if (p.recurrence !== undefined) {
      setRecurrence(p.recurrence);
      void text.patch({ recurrence: p.recurrence });
      return;
    }
    if (p.labelIds !== undefined) {
      void text.patch({ labels: p.labelIds });
      return;
    }
    void text.patch(p);
  };

  const archiveSlot = task.archived_at ? (
    <>
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
            .catch(() => text.setSaveState('error'))
        }
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-surface border border-app text-muted hover:text-text hover:bg-surface2 transition-colors duration-150"
      >
        <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
        {t('task.unarchive')}
      </button>
    </>
  ) : (
    task.column === 'hecho' && (
      <button
        type="button"
        onClick={() =>
          void data
            .archiveTask(task.id)
            .then(() => announce(t('board.taskArchived', { title: task.title })))
            .catch(() => text.setSaveState('error'))
        }
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-surface border border-app text-muted hover:text-text hover:bg-surface2 transition-colors duration-150"
      >
        <Archive className="w-4 h-4" aria-hidden="true" />
        {t('task.archive')}
      </button>
    )
  );

  return (
    <TaskFields
      value={value}
      onChange={onFieldsChange}
      onTextCommit={(field) => (field === 'title' ? text.commitTitle() : text.commitDescription())}
      titleError={text.titleError}
      idPrefix="dt"
      projects={data.getProjects()}
      labels={data.getLabels()}
      users={data.getProject(task.project_id)?.members ?? data.getUsers()}
      stageSlot={<StageSelect id="dt-stage" value={task.column} onChange={moveTo} ariaLabel={t('task.stage')} />}
      subtasksSlot={<SubtaskList taskId={task.id} subtasks={detail.subtasks ?? []} />}
      showTitle={false}
      showDescription={false}
    >
      <TaskFooter taskId={task.id} onClose={onClose} saveState={text.saveState} start={archiveSlot} />
    </TaskFields>
  );
}
