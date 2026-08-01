import { useTranslation } from 'react-i18next';
import { Plus, Move, Paperclip, Flag, Calendar, User, FileText, Type } from 'lucide-react';
import type { ActivityEventType, TaskDetail } from '@/data/types';
import { EventText } from '@/components/task/EventText';
import { relTime } from '@/i18n';

const EVENT_ICON: Record<ActivityEventType, typeof Plus> = {
  created: Plus,
  title: Type,
  description: FileText,
  priority: Flag,
  due: Calendar,
  assigned: User,
  moved: Move,
  attachment: Paperclip,
};

/** Pestaña Actividad: timeline de eventos reales (activity_events). */
export function ActivityTab({ detail }: { detail: TaskDetail }) {
  const { t } = useTranslation();

  if (detail.activity.length === 0) {
    return <p className="text-[14px] text-faint py-8 text-center">{t('activity.empty')}</p>;
  }

  return (
    <ul className="timeline space-y-4">
      {detail.activity.map((e) => {
        const Icon = EVENT_ICON[e.type] ?? Plus;
        return (
          <li key={e.id} className="flex gap-3 items-center">
            <span className="relative z-10 w-7 h-7 rounded-full bg-surface2 border border-app text-faint flex items-center justify-center shrink-0">
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
            <p className="text-[14px] text-muted leading-relaxed">
              <EventText event={e} />{' '}
              <span className="text-faint">· {relTime(e.created_at, t)}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
