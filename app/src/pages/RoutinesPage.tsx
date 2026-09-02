import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pause, Play, Repeat, Settings2 } from 'lucide-react';
import { apiFetch, apiPost } from '@/data/api-client';
import { apiErrorText } from '@/lib/errors';
import { useTaskModal } from '@/components/modal-context';
import { colorOf } from '@/lib/colors';
import { fmtFullDate } from '@/i18n';
import type { TaskRecurrence } from '@/data/types';

type RoutineStatus = 'open' | 'paused' | 'waiting';

interface RecurringSeries {
  group_id: string;
  title: string;
  project: { id: string; name: string; color: string };
  recurrence: TaskRecurrence;
  active_task_id: string | null;
  next_due: string | null;
  status: RoutineStatus;
  effective_interval_days: number;
  last_completed_at: number | null;
}

interface RecurringResponse {
  series: RecurringSeries[];
}

function freqOrder(a: TaskRecurrence['freq'], b: TaskRecurrence['freq']) {
  const map: Record<string, number> = { daily: 0, weekly: 1, monthly: 2 };
  return (map[a] ?? 3) - (map[b] ?? 3);
}

function freqLabelKey(freq: TaskRecurrence['freq']) {
  if (freq === 'daily') return 'routines.groups.daily';
  if (freq === 'weekly') return 'routines.groups.weekly';
  if (freq === 'monthly') return 'routines.groups.monthly';
  return 'routines.groups.custom';
}

export default function RoutinesPage() {
  const { t } = useTranslation();
  const { openTask } = useTaskModal();
  const [series, setSeries] = useState<RecurringSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = async () => {
    setError(null);
    try {
      const res = await apiFetch<RecurringResponse>('/api/tasks/recurring');
      setSeries(res.series);
    } catch (err) {
      setError(apiErrorText(err, t('routines.loadError')));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<TaskRecurrence['freq'], RecurringSeries[]>();
    for (const s of series) {
      const key = s.recurrence.freq;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const da = a.next_due ? new Date(a.next_due).getTime() : Infinity;
        const db = b.next_due ? new Date(b.next_due).getTime() : Infinity;
        return da - db;
      });
    }
    return new Map([...map.entries()].sort((a, b) => freqOrder(a[0], b[0])));
  }, [series]);

  const withBusy = (id: string, fn: () => Promise<void>) => {
    setBusy((prev) => new Set(prev).add(id));
    return fn().finally(() => {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  };

  const complete = (s: RecurringSeries) => {
    if (!s.active_task_id) return;
    void withBusy(`complete-${s.group_id}`, async () => {
      await apiPost(`/api/tasks/${s.active_task_id}/move`, { column: 'hecho', position: 0 });
      await load();
    });
  };

  const pause = (s: RecurringSeries) => {
    void withBusy(`pause-${s.group_id}`, async () => {
      await apiPost(`/api/tasks/recurring/${s.group_id}/pause`, {});
      await load();
    });
  };

  const resume = (s: RecurringSeries) => {
    void withBusy(`resume-${s.group_id}`, async () => {
      await apiPost(`/api/tasks/recurring/${s.group_id}/resume`, {});
      await load();
    });
  };

  const edit = (s: RecurringSeries) => {
    if (!s.active_task_id) return;
    openTask(s.active_task_id, 'detalles');
  };

  const projectDot = (p: { color: string }) => (
    <span className={`w-1.5 h-10 rounded-full shrink-0 ${colorOf(p.color).dot}`} aria-hidden="true" />
  );

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
            {t('routines.title')}
          </h1>
          <p className="text-sm text-muted mt-0.5">{t('routines.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Repeat className="w-5 h-5 text-faint" aria-hidden="true" />
          <span className="text-[13px] text-muted">{series.length}</span>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted animate-pulse" role="status">{t('common.loading')}</p>
      )}

      {!loading && error && (
        <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {!loading && series.length === 0 && !error && (
        <p className="rounded-2xl border border-dashed border-app px-4 py-6 text-center text-[14px] text-muted">
          {t('routines.empty')}
        </p>
      )}

      <div className="space-y-8">
        {Array.from(grouped.entries()).map(([freq, items]) => (
          <section key={freq} aria-labelledby={`routines-group-${freq}`}>
            <h2 id={`routines-group-${freq}`} className="flex items-center gap-3 mb-3">
              <span className="text-[12px] font-semibold tracking-wide uppercase text-faint">
                {t(freqLabelKey(freq))}
              </span>
              <span className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} aria-hidden="true" />
            </h2>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {items.map((s) => (
                <div
                  key={s.group_id}
                  className="rounded-2xl bg-surface border border-app shadow-soft px-4 py-3 flex items-center gap-3"
                >
                  {projectDot(s.project)}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium leading-snug truncate">
                      {s.title}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium ${colorOf(s.project.color).chip}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${colorOf(s.project.color).dot}`} aria-hidden="true" />
                        {s.project.name}
                      </span>
                      <span className="text-faint">
                        {s.next_due
                          ? t('routines.nextDue', { date: fmtFullDate(new Date(s.next_due)) })
                          : t('routines.noDue')}
                      </span>
                      <span className="text-faint">
                        {t('routines.interval', { days: s.effective_interval_days })}
                      </span>
                      {s.status === 'paused' && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          {t('routines.status.paused')}
                        </span>
                      )}
                      {s.status === 'waiting' && (
                        <span className="text-faint">
                          {t('routines.status.waiting')}
                        </span>
                      )}
                    </span>
                  </span>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {s.status === 'open' && s.active_task_id && (
                      <button
                        type="button"
                        title={t('routines.complete')}
                        aria-label={t('routines.completeAria', { title: s.title })}
                        disabled={busy.has(`complete-${s.group_id}`)}
                        onClick={() => complete(s)}
                        className="p-1.5 rounded-lg text-faint hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                      >
                        <Check className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}

                    {s.status !== 'paused' ? (
                      <button
                        type="button"
                        title={t('routines.pause')}
                        aria-label={t('routines.pauseAria', { title: s.title })}
                        disabled={busy.has(`pause-${s.group_id}`)}
                        onClick={() => pause(s)}
                        className="p-1.5 rounded-lg text-faint hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:opacity-50 transition-colors"
                      >
                        <Pause className="w-4 h-4" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title={t('routines.resume')}
                        aria-label={t('routines.resumeAria', { title: s.title })}
                        disabled={busy.has(`resume-${s.group_id}`)}
                        onClick={() => resume(s)}
                        className="p-1.5 rounded-lg text-faint hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                      >
                        <Play className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}

                    {s.active_task_id && (
                      <button
                        type="button"
                        title={t('routines.edit')}
                        aria-label={t('routines.editAria', { title: s.title })}
                        onClick={() => edit(s)}
                        className="p-1.5 rounded-lg text-faint hover:text-brand hover:bg-brand/10 transition-colors"
                      >
                        <Settings2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
