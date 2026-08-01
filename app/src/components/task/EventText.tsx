import { Trans, useTranslation } from 'react-i18next';
import type { ActivityEvent, ActivityEventType } from '@/data/types';
import { useData } from '@/data/data-context';
import { fmtDayMonth, parseISODate } from '@/i18n';

/**
 * Texto de un evento de actividad. Con `taskTitle` se usa la variante del feed
 * global (events.feed.*); sin ella, la variante de la pestaña Actividad (events.*).
 */
export function EventText({
  event,
  taskTitle,
}: {
  event: Pick<ActivityEvent, 'type' | 'data' | 'username'>;
  taskTitle?: string;
}) {
  const { t } = useTranslation();
  const data = useData();
  const user = event.username ?? '?';
  const scope = taskTitle !== undefined ? 'events.feed' : 'events';

  let key: string = event.type as ActivityEventType;
  const values: Record<string, string> = { user };
  if (taskTitle !== undefined) values.task = taskTitle;

  switch (event.type) {
    case 'moved':
      values.from = t(`columns.${String(event.data.from)}`);
      values.to = t(`columns.${String(event.data.to)}`);
      break;
    case 'priority':
      if (event.data.to === null || event.data.to === undefined) {
        key = 'priorityRemoved';
      } else {
        values.value = t(`priority.${String(event.data.to)}`);
      }
      break;
    case 'due':
      if (event.data.to === null || event.data.to === undefined) {
        key = 'dueRemoved';
      } else {
        values.value = fmtDayMonth(parseISODate(String(event.data.to)));
      }
      break;
    case 'assigned':
      if (event.data.to === null || event.data.to === undefined) {
        key = 'unassigned';
      } else {
        values.value = data.getUsername(String(event.data.to));
      }
      break;
    case 'attachment':
      values.value = String(event.data.filename ?? '');
      break;
    default:
      break;
  }

  return (
    <Trans
      i18nKey={`${scope}.${key}`}
      values={values}
      components={{ strong: <strong className="font-semibold text-[var(--text)]" /> }}
    />
  );
}
