import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check } from 'lucide-react';
import type { Label } from '@/data/types';
import { colorOf } from '@/lib/colors';

/** Selector múltiple de etiquetas en desplegable (compacta el modal). */
export function LabelsSelect({
  labels,
  selected,
  onChange,
  id,
  ariaLabel,
}: {
  labels: Label[];
  selected: string[];
  onChange: (ids: string[]) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sel = new Set(selected);
  const chosen = labels.filter((l) => sel.has(l.id));

  const toggle = (labelId: string) => {
    onChange(sel.has(labelId) ? selected.filter((x) => x !== labelId) : [...selected, labelId]);
  };

  return (
    <div className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? t('task.labels')}
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[42px] inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2 text-[14px] font-medium outline-none focus:border-brand"
      >
        <span className="flex-1 text-left flex flex-wrap items-center gap-1.5">
          {chosen.length === 0 ? (
            <span className="text-muted">{t('task.noLabels')}</span>
          ) : (
            chosen.map((l) => (
              <span
                key={l.id}
                className={`px-2 py-0.5 rounded-full text-[12px] font-medium ${colorOf(l.color).chip}`}
              >
                {l.name}
              </span>
            ))
          )}
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
            aria-multiselectable="true"
            aria-label={ariaLabel ?? t('task.labels')}
            className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
          >
            {labels.length === 0 && (
              <li className="px-3.5 py-2 text-[13px] text-faint">{t('task.noLabels')}</li>
            )}
            {labels.map((l) => {
              const active = sel.has(l.id);
              return (
                <li key={l.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => toggle(l.id)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2"
                  >
                    <span
                      className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                        active ? 'bg-brand border-brand text-brandfg' : 'border-app'
                      }`}
                    >
                      {active && <Check className="w-3 h-3" aria-hidden="true" />}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[12px] font-medium ${colorOf(l.color).chip}`}>
                      {l.name}
                    </span>
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
