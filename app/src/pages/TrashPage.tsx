import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/data/api-client';
import { useData } from '@/data/data-context';
import { relTime } from '@/i18n';
import { fmtMoney } from '@/lib/format';

interface TrashTask {
  id: string;
  title: string;
  project_name: string | null;
  deleted_at: number;
}

interface TrashExpense {
  id: string;
  title: string;
  amount_cents: number;
  deleted_at: number;
  created_by_username: string;
}

export default function TrashPage() {
  const { t } = useTranslation();
  const { restoreTask, restoreExpense } = useData();
  const [tasks, setTasks] = useState<TrashTask[]>([]);
  const [expenses, setExpenses] = useState<TrashExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ tasks: TrashTask[]; expenses: TrashExpense[] }>('/api/trash');
      setTasks(data.tasks);
      setExpenses(data.expenses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('trash.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRestoreTask = async (id: string) => {
    setBusy(id);
    try {
      await restoreTask(id);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onRestoreExpense = async (id: string) => {
    setBusy(id);
    try {
      await restoreExpense(id);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const isEmpty = !loading && tasks.length === 0 && expenses.length === 0;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <header className="mb-6">
        <h1 className="font-display font-bold text-2xl tracking-tight">{t('trash.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('trash.subtitle')}</p>
      </header>

      {error && (
        <p className="mb-4 rounded-xl border border-app bg-surface px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted" role="status">
          {t('common.loading')}
        </p>
      ) : isEmpty ? (
        <div className="rounded-xl border border-app bg-surface px-6 py-12 text-center">
          <Trash2 className="mx-auto mb-3 w-8 h-8 text-faint" aria-hidden="true" />
          <p className="text-sm text-muted">{t('trash.empty')}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {tasks.length > 0 && (
            <section aria-labelledby="trash-tasks">
              <h2 id="trash-tasks" className="mb-3 text-[11px] font-semibold tracking-widest text-faint">
                {t('trash.tasks')}
              </h2>
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center gap-3 rounded-xl border border-app bg-surface px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="mt-0.5 truncate text-xs text-faint">
                        {task.project_name ?? t('trash.noProject')} · {relTime(task.deleted_at, t)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onRestoreTask(task.id)}
                      disabled={busy === task.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-app px-3 py-1.5 text-sm font-medium text-muted hover:text-text disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('trash.restore')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {expenses.length > 0 && (
            <section aria-labelledby="trash-expenses">
              <h2 id="trash-expenses" className="mb-3 text-[11px] font-semibold tracking-widest text-faint">
                {t('trash.expenses')}
              </h2>
              <ul className="space-y-2">
                {expenses.map((expense) => (
                  <li
                    key={expense.id}
                    className="flex items-center gap-3 rounded-xl border border-app bg-surface px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{expense.title}</p>
                      <p className="mt-0.5 truncate text-xs text-faint">
                        {fmtMoney(expense.amount_cents)} · {expense.created_by_username} ·{' '}
                        {relTime(expense.deleted_at, t)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onRestoreExpense(expense.id)}
                      disabled={busy === expense.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-app px-3 py-1.5 text-sm font-medium text-muted hover:text-text disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('trash.restore')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
