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
          <div className="grid grid-cols-3 gap-1 rounded-full bg-surface2 p-1" role="group" aria-label={t('task.recurrenceFreq')}>
            {(['daily', 'weekly', 'monthly'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={rec.freq === f}
                onClick={() => set({ freq: f })}
                className={`rounded-full px-2 h-9 text-[13px] font-medium ${
                  rec.freq === f ? 'bg-surface shadow-soft' : 'text-muted'
                }`}
              >
                {t(`task.recurrenceFreq.${f}`)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label
                htmlFor={`${idPrefix}-rec-interval`}
                className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
              >
                {t('task.recurrenceEvery')}
              </label>
              <input
                id={`${idPrefix}-rec-interval`}
                type="number"
                min={1}
                max={999}
                value={rec.interval}
                onChange={(e) => set({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                className="w-full bg-surface2 border border-app rounded-xl px-3 py-2 text-[14px] outline-none focus:border-brand"
              />
            </div>
            <p className="text-[13px] text-faint pt-5">
              {t(`task.recurrenceUnit.${rec.freq}`)}
            </p>
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

          <div>
            <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
              {t('task.recurrenceMode')}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
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
            {rec.mode === 'completion' && (
              <p className="text-[12px] text-faint mt-1.5">{t('task.recurrenceMode.completionHint')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
