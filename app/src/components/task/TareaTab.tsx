import type { TaskDetail } from '@/data/types';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { TaskFields, type TaskFieldsValue } from '@/components/task/TaskFields';
import { TaskFooter } from '@/components/task/TaskFooter';
import { useTaskText } from '@/components/task/useTaskText';

/** Pestaña Tarea: lectura y escritura limpias con solo el título y la
 *  descripción, y el pie con Eliminar (izquierda, doble confirmación),
 *  Cancelar y Guardar destacado. Si la tarea se aplaza una y otra vez
 *  (issue #255), un aviso ofrece acciones para desbloquearla. */
export function TareaTab({
  detail,
  onClose,
  onNavigate,
}: {
  detail: TaskDetail;
  onClose: () => void;
  onNavigate: (tab: 'detalles') => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const task = detail.task;
  const text = useTaskText(task);
  const threshold = me.anti_slip_threshold ?? 3;
  const dragged = threshold > 0 && task.slips >= threshold;

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
      {dragged && (
        <div className="mb-4 rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-amber-800 dark:text-amber-300">
            <Flame className="w-4 h-4 shrink-0" aria-hidden="true" />
            {t('task.draggedBanner', { count: task.slips })}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void data.doTodayTask(task.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-brandfg hover:brightness-110"
            >
              {t('task.doToday')}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('detalles')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-app bg-surface px-3 py-1.5 text-[12px] font-medium text-muted hover:bg-surface2 hover:text-text"
            >
              {t('task.replanOrSplit')}
            </button>
          </div>
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
