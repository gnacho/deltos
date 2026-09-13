import { useTranslation } from 'react-i18next';
import { Repeat, RotateCcw } from 'lucide-react';
import type { TaskRecurrence } from '@/data/types';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
      {children}
    </p>
  );
}

/** Selector de recurrencia compartido entre el modal de creación y el detalle.
 *  Mantiene estado local; el padre lo commitea con onChange. */
export function RecurrenceField({
  value,
  onChange,
  idPrefix,
}: {
  value: TaskRecurrence | null;
  onChange: (r: TaskRecurrence | null) => void;
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const rec = value;

  const set = (patch: Partial<TaskRecurrence>) => {
    const base: TaskRecurrence = rec ?? { freq: 'weekly', interval: 1, weekdays: null, mode: 'due' };
    const next: TaskRecurrence = { ...base, ...patch };
    // weekdays solo tiene sentido en weekly
    if (next.freq !== 'weekly') next.weekdays = null;
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <FieldLabel>{t('task.recurrence')}</FieldLabel>
        {rec && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-rose-600 dark:hover:text-rose-400"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            {t('task.recurrenceOff')}
          </button>
        )}
      </div>

      {!rec ? (
        <button
          type="button"
          onClick={() => onChange({ freq: 'weekly', interval: 1, weekdays: null, mode: 'due' })}
          className="w-full inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[14px] font-medium text-muted outline-none focus:border-brand hover:bg-surface"
        >
          <Repeat className="w-4 h-4" aria-hidden="true" />
          {t('task.recurrenceAdd')}
        </button>
      ) : (
        <div className="space-y-3">
          {/* Cada [n] [unidad] y Cuándo se calcula, en la misma fila */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${idPrefix}-rec-interval`}
                className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
              >
                {t('task.recurrenceEvery')}
              </label>
              <div className="flex gap-1.5">
                <input
                  id={`${idPrefix}-rec-interval`}
                  type="number"
                  min={1}
                  max={999}
                  value={rec.interval}
                  onChange={(e) => set({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className="w-16 shrink-0 bg-surface2 border border-app rounded-xl px-3 py-2 text-[14px] outline-none focus:border-brand"
                />
                <select
                  value={rec.freq}
                  onChange={(e) => set({ freq: e.target.value as TaskRecurrence['freq'] })}
                  aria-label={t('task.recurrenceFreq')}
                  className="flex-1 min-w-0 bg-surface2 border border-app rounded-xl px-2 py-2 text-[14px] outline-none focus:border-brand"
                >
                  {(['daily', 'weekly', 'monthly'] as const).map((f) => (
                    <option key={f} value={f}>
                      {t(`task.recurrenceUnit.${f}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
                {t('task.recurrenceMode')}
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                <button
                  type="button"
                  aria-pressed={rec.mode === 'due'}
                  onClick={() => set({ mode: 'due' })}
                  className={`rounded-xl px-3 py-2 text-[13px] text-left ${
                    rec.mode === 'due'
                      ? 'bg-brand/10 text-brand ring-1 ring-brand font-medium'
                      : 'bg-surface border border-app text-muted hover:bg-surface2'
                  }`}
                >
                  {t('task.recurrenceMode.due')}
                </button>
                <button
                  type="button"
                  aria-pressed={rec.mode === 'completion'}
                  onClick={() => set({ mode: 'completion' })}
                  className={`rounded-xl px-3 py-2 text-[13px] text-left ${
                    rec.mode === 'completion'
                      ? 'bg-brand/10 text-brand ring-1 ring-brand font-medium'
                      : 'bg-surface border border-app text-muted hover:bg-surface2'
                  }`}
                >
                  {t('task.recurrenceMode.completion')}
                </button>
              </div>
            </div>
          </div>

          {rec.freq === 'weekly' && (
            <div>
              <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
                {t('task.recurrenceWeekdays')}
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('task.recurrenceWeekdays')}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                  const active = (rec.weekdays ?? []).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const cur = rec.weekdays ?? [];
                        const next = active ? cur.filter((x) => x !== d) : [...cur, d].sort();
                        set({ weekdays: next });
                      }}
                      className={`w-9 h-9 rounded-full text-[13px] font-medium ${
                        active
                          ? 'bg-brand text-brandfg'
                          : 'bg-surface border border-app text-muted hover:bg-surface2'
                      }`}
                    >
                      {t(`task.recurrenceWeekday.${d}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {rec.mode === 'completion' && (
            <p className="text-[12px] text-faint">{t('task.recurrenceMode.completionHint')}</p>
          )}
        </div>
      )}
    </div>
  );
}
