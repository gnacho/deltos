import type { TaskDetail } from '@/data/types';
import { useData } from '@/data/data-context';
import { TaskFields, type TaskFieldsValue } from '@/components/task/TaskFields';
import { TaskFooter } from '@/components/task/TaskFooter';
import { useTaskText } from '@/components/task/useTaskText';

/** Pestaña Tarea: lectura y escritura limpias con solo el título y la
 *  descripción, y el pie con Eliminar (izquierda, doble confirmación),
 *  Cancelar y Guardar destacado. */
export function TareaTab({ detail, onClose }: { detail: TaskDetail; onClose: () => void }) {
  const data = useData();
  const task = detail.task;
  const text = useTaskText(task);

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
  );
}
