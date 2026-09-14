import { useTranslation } from 'react-i18next';
import { useData } from '@/data/data-context';
import { useTaskModal } from '@/components/modal-context';

/**
 * Chip de una referencia `[[ID]]`. Abre la tarea citada. Si el id no
 * corresponde a ninguna tarea visible para el usuario, pinta el texto literal
 * en lugar de un enlace muerto.
 */
export default function TaskRef({ shortId }: { shortId: string }) {
  const { t } = useTranslation();
  const data = useData();
  const { openTask } = useTaskModal();
  const task = data.getTaskByShortId(shortId);
  if (!task) return <>{`[[${shortId}]]`}</>;
  const id = task.short_id ?? shortId;
  return (
    <button
      type="button"
      onClick={() => openTask(task.id)}
      title={task.title}
      aria-label={t('task.refOpen', { id, title: task.title })}
      className="tnum inline-flex items-center rounded-md border border-app bg-surface2 px-1.5 py-0.5 align-baseline text-[12px] text-muted hover:border-brand hover:text-brand"
    >
      {id}
    </button>
  );
}
