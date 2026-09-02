import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, CalendarClock, ChevronRight, ListTodo } from 'lucide-react';
import type { Expense, Task } from '@/data/types';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { useTaskModal } from '@/components/modal-context';
import { ExpenseDetailModal } from '@/components/ExpenseDetailModal';
import { PriorityBadge, DueBadge } from '@/components/badges';
import { colorOf } from '@/lib/colors';
import { fmtMoney } from '@/lib/format';
import { parseISODate, fmtFullDate } from '@/i18n';
import ActivityFeed from '@/components/ActivityFeed';
import { apiPost } from '@/data/api-client';

type Tab = 'reminders' | 'activity';

const PRIORITY_ORDER: Record<string, number> = { alta: 0, media: 1, baja: 2 };

interface TaskBucket {
  key: 'over' | 'today' | 'upcoming' | 'high';
  tasks: Task[];
}

/** Agrupa tareas abiertas por urgencia. Orden global: vencidas → hoy → próximas (7 días) →
 *  sin fecha con prioridad alta. Dentro de cada grupo: fecha (asc) y luego prioridad. */
function bucketTasks(tasks: Task[], today: Date): TaskBucket[] {
  const over: Task[] = [];
  const dueToday: Task[] = [];
  const upcoming: Task[] = [];
  const high: Task[] = [];
  for (const t of tasks) {
    if (t.column === 'hecho') continue;
    if (!t.due_date) {
      if (t.priority === 'alta') high.push(t);
      continue;
    }
    const d = parseISODate(t.due_date);
    const diff = Math.round((d.getTime() - today.getTime()) / 864e5);
    if (diff < 0) over.push(t);
    else if (diff === 0) dueToday.push(t);
    else if (diff <= 7) upcoming.push(t);
  }
  const byDate = (a: Task, b: Task) =>
    (a.due_date ?? '').localeCompare(b.due_date ?? '') ||
    (PRIORITY_ORDER[a.priority ?? ''] ?? 3) - (PRIORITY_ORDER[b.priority ?? ''] ?? 3);
  const byPriority = (a: Task, b: Task) =>
    (PRIORITY_ORDER[a.priority ?? ''] ?? 3) - (PRIORITY_ORDER[b.priority ?? ''] ?? 3);
  over.sort(byDate);
  dueToday.sort(byDate);
  upcoming.sort(byDate);
  high.sort(byPriority);
  return [
    { key: 'over', tasks: over },
    { key: 'today', tasks: dueToday },
    { key: 'upcoming', tasks: upcoming },
    { key: 'high', tasks: high },
  ].filter((b): b is TaskBucket => b.tasks.length > 0);
}

/** Gastos pendientes respecto a mí: lo que debo y lo que me deben, con su importe pendiente. */
function pendingExpenses(expenses: Expense[], meId: string) {
  const youOwe: { expense: Expense; cents: number }[] = [];
  const owedToYou: { expense: Expense; cents: number }[] = [];
  for (const e of expenses) {
    if (e.step === 'hecho') continue;
    const myOwed = e.shares
      .filter((s) => s.user_id === meId && !s.paid)
      .reduce((s, x) => s + x.share_cents, 0);
    const othersOwe = e.shares
      .filter((s) => s.user_id !== meId && !s.paid && e.payer_id === meId)
      .reduce((s, x) => s + x.share_cents, 0);
    if (myOwed > 0) youOwe.push({ expense: e, cents: myOwed });
    if (othersOwe > 0) owedToYou.push({ expense: e, cents: othersOwe });
  }
  const byStep = (a: { expense: Expense }, b: { expense: Expense }) =>
    a.expense.step === b.expense.step
      ? b.expense.spent_at - a.expense.spent_at
      : a.expense.step === 'nuevo'
        ? -1
        : b.expense.step === 'nuevo'
          ? 1
          : 0;
  return { youOwe: youOwe.sort(byStep), owedToYou: owedToYou.sort(byStep) };
}

export default function SummaryPage() {
  const { t, i18n } = useTranslation();
  const data = useData();
  const { user } = useSession();
  const { openTask } = useTaskModal();
  const [tab, setTab] = useState<Tab>('reminders');
  const [detailExpense, setDetailExpense] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<Set<string>>(new Set());

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const buckets = useMemo(() => bucketTasks(data.getTasks(), today), [data, today]);
  const { youOwe, owedToYou } = useMemo(
    () => pendingExpenses(data.getExpenses(), user.id),
    [data, user.id],
  );

  const taskCount = buckets.reduce((s, b) => s + b.tasks.length, 0);
  const expenseCount = youOwe.length + owedToYou.length;

  const sectionLabel: Record<TaskBucket['key'], string> = {
    over: t('summary.tasks.overdue'),
    today: t('summary.tasks.today'),
    upcoming: t('summary.tasks.upcoming'),
    high: t('summary.tasks.highPriority'),
  };

  const openExpense = (id: string) => {
    data.refreshExpenseDetail(id);
    setDetailExpense(id);
  };

  const archiveTask = async (task: Task) => {
    if (archiving.has(task.id)) return;
    setArchiving((prev) => new Set(prev).add(task.id));
    try {
      await apiPost(`/api/tasks/${task.id}/done-and-archive`, {});
    } finally {
      setArchiving((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
            {t('summary.title')}
          </h1>
          <p className="text-sm text-muted mt-0.5">{t('summary.subtitle')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label={t('summary.title')} className="mb-5 inline-flex rounded-xl bg-surface2 p-1">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reminders'}
          onClick={() => setTab('reminders')}
          className={`flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-colors ${
            tab === 'reminders' ? 'bg-surface shadow-soft text-text' : 'text-muted hover:text-text'
          }`}
        >
          <ListTodo className="w-4 h-4" aria-hidden="true" />
          {t('summary.tabs.reminders')}
          {(taskCount + expenseCount) > 0 && (
            <span className="tnum text-[11px] text-faint">({taskCount + expenseCount})</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'activity'}
          onClick={() => setTab('activity')}
          className={`flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-colors ${
            tab === 'activity' ? 'bg-surface shadow-soft text-text' : 'text-muted hover:text-text'
          }`}
        >
          <CalendarClock className="w-4 h-4" aria-hidden="true" />
          {t('summary.tabs.activity')}
        </button>
      </div>

      {tab === 'activity' ? (
        <ActivityFeed />
      ) : (
        <div className="max-w-[1100px] mx-auto space-y-8">
          {/* Tareas */}
          <section aria-labelledby="summary-tasks">
            <h2 className="flex items-center gap-3 mb-3">
              <span className="text-[12px] font-semibold tracking-wide uppercase text-faint">
                {t('summary.tasks.heading')}
              </span>
              <span
                className="flex-1 h-px"
                style={{ backgroundColor: 'var(--border)' }}
                aria-hidden="true"
              />
            </h2>
            {buckets.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-app px-4 py-6 text-center text-[14px] text-muted">
                {t('summary.tasks.empty')}
              </p>
            ) : (
              <div className="space-y-5">
                {buckets.map((bucket) => (
                  <div key={bucket.key}>
                    <h3 className="text-[13px] font-semibold text-muted mb-2">{sectionLabel[bucket.key]}</h3>
                    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                      {bucket.tasks.map((task) => {
                        const project = data.getProject(task.project_id);
                        return (
                          <div
                            key={task.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openTask(task.id, 'detalles')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openTask(task.id, 'detalles');
                              }
                            }}
                            aria-label={t('task.openDetail', { title: task.title })}
                            className="card w-full text-left rounded-2xl bg-surface border border-app shadow-soft px-4 py-3 flex items-center gap-3 cursor-pointer"
                          >
                            <span
                              className={`w-1.5 h-10 rounded-full shrink-0 ${colorOf(project?.color ?? 'slate').dot}`}
                              aria-hidden="true"
                            />
                            <span className="flex-1 min-w-0">
                              <span className="block text-[14px] font-medium leading-snug truncate">
                                {task.title}
                              </span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {task.priority && <PriorityBadge priority={task.priority} />}
                                {task.due_date && <DueBadge due={task.due_date} />}
                              </span>
                            </span>
                            <ChevronRight className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />
                            <button
                              type="button"
                              aria-label={t('summary.tasks.archiveAria', { title: task.title })}
                              title={t('summary.tasks.archive')}
                              disabled={archiving.has(task.id)}
                              onClick={(e) => {
                                e.stopPropagation();
                                void archiveTask(task);
                              }}
                              className="shrink-0 p-1.5 rounded-lg text-faint hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
                            >
                              <Archive className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Gastos */}
          <section aria-labelledby="summary-expenses">
            <h2 className="flex items-center gap-3 mb-3">
              <span className="text-[12px] font-semibold tracking-wide uppercase text-faint">
                {t('summary.expenses.heading')}
              </span>
              <span
                className="flex-1 h-px"
                style={{ backgroundColor: 'var(--border)' }}
                aria-hidden="true"
              />
            </h2>
            {youOwe.length === 0 && owedToYou.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-app px-4 py-6 text-center text-[14px] text-muted">
                {t('summary.expenses.empty')}
              </p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {[
                  { title: t('summary.expenses.youOwe'), items: youOwe, accent: 'text-rose-600 dark:text-rose-400' },
                  { title: t('summary.expenses.owedToYou'), items: owedToYou, accent: 'text-emerald-600 dark:text-emerald-400' },
                ]
                  .filter(({ items }) => items.length > 0)
                  .map(({ title, items, accent }) => (
                    <div key={title}>
                      <h3 className="text-[13px] font-semibold text-muted mb-2">{title}</h3>
                      <div className="space-y-2">
                        {items.map(({ expense, cents }) => {
                          const project = expense.project_id ? data.getProject(expense.project_id) : undefined;
                          return (
                            <button
                              key={expense.id}
                              type="button"
                              onClick={() => openExpense(expense.id)}
                              className="card w-full text-left rounded-2xl bg-surface border border-app shadow-soft px-4 py-3 flex items-center gap-3"
                            >
                              <span className="flex-1 min-w-0">
                                <span className="block text-[14px] font-medium leading-snug truncate">
                                  {expense.title}
                                </span>
                                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${colorOf(project?.color ?? 'slate').chip}`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${colorOf(project?.color ?? 'slate').dot}`}
                                      aria-hidden="true"
                                    />
                                    {project?.name ?? expense.project_name}
                                  </span>
                                  <span className="text-[12px] text-faint">
                                    {fmtFullDate(new Date(expense.spent_at))}
                                  </span>
                                </span>
                              </span>
                              <span className={`tnum text-[15px] font-semibold ${accent}`}>
                                {fmtMoney(cents, i18n.language)}
                              </span>
                              <ChevronRight className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}

      {detailExpense && data.getExpense(detailExpense) && (
        <ExpenseDetailModal
          expense={data.getExpense(detailExpense)!}
          onClose={() => {
            data.releaseExpenseDetail(detailExpense);
            setDetailExpense(null);
          }}
          onDeleted={() => setDetailExpense(null)}
        />
      )}
    </div>
  );
}
