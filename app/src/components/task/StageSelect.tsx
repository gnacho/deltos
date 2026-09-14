import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { ColumnId } from '@/data/types';
import { COLUMNS } from '@/lib/constants';
import { colorOf } from '@/lib/colors';

/** Selector de etapa (columna) en desplegable. */
export function StageSelect({
  value,
  onChange,
  id,
  ariaLabel,
}: {
  value: ColumnId;
  onChange: (column: ColumnId) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = COLUMNS.find((c) => c.id === value);

  return (
    <div className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? t('task.stage')}
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[14px] font-medium outline-none focus:border-brand"
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${selected ? colorOf(selected.color).dot : 'bg-faint/40'}`}
          aria-hidden="true"
        />
        <span className="flex-1 text-left truncate">
          {selected ? t(`columns.${selected.id}`) : t('task.stage')}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-faint shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul
            role="listbox"
            aria-label={ariaLabel ?? t('task.stage')}
            className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
          >
            {COLUMNS.map((c) => {
              const active = c.id === value;
              return (
                <li key={c.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!active) onChange(c.id);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                      active ? 'font-medium text-brand' : ''
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${colorOf(c.color).dot}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{t(`columns.${c.id}`)}</span>
                    {active && (
                      <span className="text-[12px] font-semibold">{t('task.current')}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
