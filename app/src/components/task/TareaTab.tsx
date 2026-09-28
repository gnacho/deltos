import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDetail } from '@/data/types';
import { useData } from '@/data/data-context';
import { TaskFields, type TaskFieldsValue } from '@/components/task/TaskFields';
import { TaskFooter } from '@/components/task/TaskFooter';
import { useTaskText } from '@/components/task/useTaskText';

/** Pestaña Tarea: lectura y escritura limpias con solo el título y la
 *  descripción, el id corto con su copia, y el pie con Eliminar (izquierda,
 *  doble confirmación), Cancelar y Guardar destacado. */
export function TareaTab({ detail, onClose }: { detail: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const data = useData();
  const task = detail.task;
  const text = useTaskText(task);
  const [idCopied, setIdCopied] = useState(false);

  const value: TaskFieldsValue = {
    title: text.title,
    description: text.description,
    project_id: task.project_id,
    priority: task.priority,
    assignee_id: task.assignee_id,
    due_date: task.due_date,
    recurrence: task.recurrence,
    labelIds: task.labels.map((l) => l.id),
  };

  const onFieldsChange = (p: Partial<TaskFieldsValue>) => {
    if (p.title !== undefined) {
      text.setTitle(p.title);
      return;
    }
    if (p.description !== undefined) {
      text.setDescription(p.description);
    }
  };

  return (
    <>
      {task.short_id && (
        <div className="mb-4 flex items-center gap-2">
          <span className="tnum rounded-md border border-app bg-surface2 px-2 py-0.5 text-[12px] text-muted">
            {task.short_id}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!navigator.clipboard) return;
              void navigator.clipboard
                .writeText(task.short_id ?? '')
                .then(() => {
                  setIdCopied(true);
                  window.setTimeout(() => setIdCopied(false), 1500);
                })
                .catch(() => {});
            }}
            className="text-[12px] font-medium text-brand hover:underline"
          >
            {idCopied ? t('task.idCopied') : t('task.copyId')}
          </button>
        </div>
      )}
      <TaskFields
        value={value}
        onChange={onFieldsChange}
        onTextCommit={(field) => (field === 'title' ? text.commitTitle() : text.commitDescription())}
        titleError={text.titleError}
        idPrefix="tt"
        projects={data.getProjects()}
        labels={data.getLabels()}
        users={data.getProject(task.project_id)?.members ?? data.getUsers()}
        showFieldRows={false}
      >
        <TaskFooter
          taskId={task.id}
          onClose={onClose}
          saveState={text.saveState}
          prominentSave
        />
      </TaskFields>
    </>
  );
}
