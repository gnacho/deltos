import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Check } from 'lucide-react';
import { useData } from '@/data/data-context';
import { useTaskModal } from '@/components/modal-context';
import { DueBadge, PriorityBadge, TagChip, UnassignedAvatar } from '@/components/badges';
import { colorOf } from '@/lib/colors';
import { projectDisplayName } from '@/lib/projects';
import { fmtFullDate } from '@/i18n';
import { fireConfetti } from '@/lib/confetti';
import type { Task } from '@/data/types';

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);
}

export default function TodayPage() {
  const { t } = useTranslation();
  const data = useData();
  const { openTask } = useTaskModal();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const todayKey = localDayKey(new Date());

  const { overdue, dueToday, doneToday } = useMemo(() => {
    const tasks = data.getTasks();
    const open = tasks.filter((tk) => !tk.archived_at && tk.column !== 'hecho');
    const overdueList = open
      .filter((tk) => tk.due_date && tk.due_date < todayKey)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : a.created_at - b.created_at));
    const dueList = open
      .filter((tk) => tk.due_date === todayKey)
      .sort((a, b) => a.position - b.position || a.created_at - b.created_at);
    const startOfDay = new Date(`${todayKey}T00:00:00`).getTime();
    const doneList = tasks
      .filter((tk) => tk.done_at !== null && tk.done_at >= startOfDay)
      .sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0));
    return { overdue: overdueList, dueToday: dueList, doneToday: doneList };
  }, [data, todayKey]);

  const complete = (task: Task) => {
    setBusy((prev) => new Set(prev).add(task.id));
    setError(null);
    data
      .moveTask(task.id, 'hecho', 0)
      .then(() => fireConfetti())
      .catch(() => setError(t('today.completeError', { title: task.title })))
      .finally(() => {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      });
  };


  const renderRow = (task: Task, extra?: ReactNode) => {
    const project = data.getProject(task.project_id);
    return (
      <div
        key={task.id}
        className="rounded-2xl bg-surface border border-app shadow-soft px-4 py-3 flex items-center gap-3"
      >
        <button
          type="button"
          title={t('today.complete')}
          aria-label={t('today.completeAria', { title: task.title })}
          disabled={busy.has(task.id)}
          onClick={() => complete(task)}
          className="p-1.5 rounded-lg text-faint hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-50 transition-colors shrink-0"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => openRow(task)}
          className="flex-1 min-w-0 text-left"
          aria-label={t('today.openAria', { title: task.title })}
        >
          <span className="block text-[14px] font-medium leading-snug truncate">{task.title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
            {project && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium ${colorOf(project.color).chip}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${colorOf(project.color).dot}`} aria-hidden="true" />
                {projectDisplayName(project, t)}
              </span>
            )}
            <DueBadge due={task.due_date} />
            {task.priority && <PriorityBadge priority={task.priority} />}
            {task.labels.map((l) => (
              <TagChip key={l.id} label={l} />
            ))}
            {extra}
            <span className="inline-flex items-center gap-1 text-faint">
              {task.assignee ? (
                <>
                  <span className={`w-4 h-4 rounded-full ${colorOf(task.assignee.color).dot}`} aria-hidden="true" />
                  {task.assignee.username}
                </>
              ) : (
                <UnassignedAvatar />
              )}
            </span>
          </span>
        </button>
      </div>
    );
  };

  const renderDoneRow = (task: Task) => {
    const project = data.getProject(task.project_id);
    return (
      <div
        key={task.id}
        className="rounded-2xl bg-surface border border-app shadow-soft px-4 py-3 flex items-center gap-3 opacity-75"
      >
        <span className="p-1.5 text-emerald-600 shrink-0" aria-hidden="true">
          <Check className="w-4 h-4" />
        </span>
        <button
          type="button"
          onClick={() => openRow(task)}
          className="flex-1 min-w-0 text-left"
          aria-label={t('today.openAria', { title: task.title })}
        >
          <span className="block text-[14px] font-medium leading-snug truncate line-through decoration-faint">
            {task.title}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
            {project && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium ${colorOf(project.color).chip}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${colorOf(project.color).dot}`} aria-hidden="true" />
                {projectDisplayName(project, t)}
              </span>
            )}
            {task.assignee && <span className="text-faint">{task.assignee.username}</span>}
          </span>
        </button>
      </div>
    );
  };

  const sections: { key: string; items: Task[]; done?: boolean; extra?: (tk: Task) => ReactNode }[] = [
    {
      key: 'overdue',
      items: overdue,
      extra: (tk) =>
        tk.due_date ? (
          <span className="text-rose-600 dark:text-rose-400 font-medium">
            {t('today.overdueDays', { count: daysBetween(tk.due_date, todayKey) })}
          </span>
        ) : undefined,
    },
    { key: 'dueToday', items: dueToday },
    { key: 'doneToday', items: doneToday, done: true },
  ];

  const total = overdue.length + dueToday.length;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">{t('today.title')}</h1>
          <p className="text-sm text-muted mt-0.5">
            {t('today.subtitle', { date: fmtFullDate(new Date()) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-faint" aria-hidden="true" />
          <span className="text-[13px] text-muted">{total}</span>
        </div>
      </div>

      {!data.ready && (
        <p className="text-sm text-muted animate-pulse" role="status">{t('common.loading')}</p>
      )}

      {data.ready && error && (
        <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {data.ready && total === 0 && doneToday.length === 0 && (
        <p className="rounded-2xl border border-dashed border-app px-4 py-6 text-center text-[14px] text-muted">
          {t('today.emptyAll')}
        </p>
      )}

      <div className="space-y-8">
        {sections.map(({ key, items, done, extra }) =>
          items.length === 0 ? null : (
            <section key={key} aria-labelledby={`today-group-${key}`}>
              <h2 id={`today-group-${key}`} className="flex items-center gap-3 mb-3">
                <span className="text-[12px] font-semibold tracking-wide uppercase text-faint">
                  {t(`today.groups.${key}`)}
                </span>
                <span className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} aria-hidden="true" />
              </h2>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {items.map((tk) => (done ? renderDoneRow(tk) : renderRow(tk, extra?.(tk))))}
              </div>
            </section>
          )
        )}
      </div>
    </div>
  );
}
