import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ArrowUp, ArrowRight, ArrowDown } from 'lucide-react';
import type { Priority } from '@/data/types';
import { PRIORITY_BADGE } from '@/lib/constants';

/** Selector de prioridad en desplegable. */
export function PrioritySelect({
  value,
  onChange,
  id,
  ariaLabel,
}: {
  value: Priority | null;
  onChange: (priority: Priority | null) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = value;

  const options: { key: Priority | null; label: string; icon: typeof ArrowUp | null; badge: string | null }[] = [
    { key: 'alta', label: t('priority.alta'), icon: ArrowUp, badge: PRIORITY_BADGE.alta },
    { key: 'media', label: t('priority.media'), icon: ArrowRight, badge: PRIORITY_BADGE.media },
    { key: 'baja', label: t('priority.baja'), icon: ArrowDown, badge: PRIORITY_BADGE.baja },
    { key: null, label: t('priority.none'), icon: null, badge: null },
  ];

  const activeOption = options.find((o) => o.key === selected) ?? options[3];

  return (
    <div className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? t('task.priority')}
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[14px] font-medium outline-none focus:border-brand"
      >
        {activeOption.icon && (
          <activeOption.icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] font-medium ${
            activeOption.badge ?? 'bg-surface border border-app text-muted'
          }`}
        >
          {activeOption.label}
        </span>
        <span className="flex-1" />
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
            aria-label={ariaLabel ?? t('task.priority')}
            className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
          >
            {options.map((o) => {
              const active = o.key === selected;
              return (
                <li key={o.key ?? 'none'} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!active) onChange(o.key);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                      active ? 'font-medium text-brand' : ''
                    }`}
                  >
                    {o.icon && <o.icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] font-medium ${
                        o.badge ?? 'bg-surface border border-app text-muted'
                      }`}
                    >
                      {o.label}
                    </span>
                    {active && (
                      <span className="ml-auto text-[12px] font-semibold">{t('task.current')}</span>
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
