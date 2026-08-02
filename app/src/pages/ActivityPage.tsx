import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Plus,
  Move,
  Paperclip,
  Flag,
  Calendar,
  User,
  FileText,
  Type,
} from 'lucide-react';
import { apiFetch } from '@/data/api-client';
import { apiErrorText } from '@/lib/errors';
import type { ActivityEventType, ActivityFeed, ActivityFeedItem } from '@/data/types';
import { useData } from '@/data/data-context';
import { useTaskModal } from '@/components/modal-context';
import { EventText } from '@/components/task/EventText';
import { colorOf } from '@/lib/colors';
import { relTime, fmtFullDate } from '@/i18n';

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

const PAGE_SIZE = 30;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Vista Actividad: feed global con paginación keyset ("Cargar más" usa nextCursor), agrupado por día. */
export default function ActivityPage() {
  const { t } = useTranslation();
  const data = useData();
  const { openTask } = useTaskModal();

  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const qs = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
        const res = await apiFetch<ActivityFeed>(`/api/activity?limit=${PAGE_SIZE}${qs}`);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
        setHasMore(res.hasMore);
      } catch (err) {
        setError(apiErrorText(err, t('activityPage.error')));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(null, false);
  }, [load]);

  /* Agrupar por día manteniendo el orden (reciente primero) */
  const groups: { key: string; label: string; items: ActivityFeedItem[] }[] = [];
  for (const it of items) {
    const key = dayKey(it.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(it);
    } else {
      const today = dayKey(Date.now());
      const yesterday = dayKey(Date.now() - 864e5);
      const label =
        key === today
          ? t('activityPage.today')
          : key === yesterday
            ? t('activityPage.yesterday')
            : fmtFullDate(new Date(it.created_at));
      groups.push({ key, label, items: [it] });
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
            {t('nav.activity')}
          </h1>
          <p className="text-sm text-muted mt-0.5">{t('activityPage.subtitle')}</p>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto">
        {loading ? (
          <div className="animate-pulse space-y-2.5" role="status">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-surface2" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-surface border border-app shadow-soft p-8 text-center">
            <p className="text-[15px] font-medium mb-1">{t('common.error')}</p>
            <p className="text-sm text-muted mb-4">{error}</p>
            <button
              type="button"
              onClick={() => void load(null, false)}
              className="px-5 py-2.5 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-app px-4 py-10 text-center text-[15px] text-muted">
            {t('activityPage.empty')}
          </p>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key}>
                <h2 className="flex items-center gap-3 mt-7 mb-3 first:mt-0">
                  <span className="text-[12px] font-semibold tracking-wide uppercase text-faint shrink-0">
                    {g.label}
                  </span>
                  <span
                    className="flex-1 h-px"
                    style={{ backgroundColor: 'var(--border)' }}
                    aria-hidden="true"
                  />
                </h2>
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {g.items.map((it, i) => {
                  const Icon = EVENT_ICON[it.type] ?? Plus;
                  const project = data.getProject(it.project_id);
                  const pColor = project?.color ?? 'slate';
                  const pName = project?.name ?? it.project_name;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => openTask(it.task_id, 'actividad')}
                      style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                      className="card w-full text-left flex items-center gap-3 rounded-2xl bg-surface border border-app shadow-soft px-4 py-3"
                      aria-label={t('task.openDetail', { title: it.task_title })}
                    >
                      <span className="w-9 h-9 rounded-full bg-surface2 border border-app text-faint flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] leading-snug">
                          <EventText event={it} taskTitle={it.task_title} />
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${colorOf(pColor).chip}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${colorOf(pColor).dot}`}
                              aria-hidden="true"
                            />
                            {pName}
                          </span>
                          <span className="text-[12px] text-faint">
                            {relTime(it.created_at, t)}
                          </span>
                        </span>
                      </span>
                      <span className="text-faint shrink-0">
                        <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      </span>
                    </button>
                  );
                })}
                </div>
              </section>
            ))}

            {hasMore && nextCursor && (
              <button
                type="button"
                onClick={() => void load(nextCursor, true)}
                disabled={loadingMore}
                className="w-full mt-2 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-app px-4 py-3.5 text-[14px] font-medium text-muted hover:bg-surface2 disabled:opacity-60"
              >
                {loadingMore ? t('activityPage.loadingMore') : t('activityPage.loadMore')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
