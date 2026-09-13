import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { Project } from '@/data/types';
import { colorOf } from '@/lib/colors';
import { projectDisplayName, inboxProject } from '@/lib/projects';

/** Selector de proyecto compartido (crear/editar tarea). Incluye la opción
 *  "Sin proyecto" (proyecto inbox) como primera entrada. */
export function ProjectSelect({
  value,
  onChange,
  projects,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (projectId: string) => void;
  projects: Project[];
  id?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = projects.find((p) => p.id === value);
  const inbox = inboxProject(projects);
  const real = projects.filter((p) => !p.is_inbox);

  return (
    <div className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[14px] font-medium outline-none focus:border-brand"
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${selected && !selected.is_inbox ? colorOf(selected.color).dot : 'bg-faint/40'}`}
          aria-hidden="true"
        />
        <span className="flex-1 text-left truncate">{projectDisplayName(selected, t)}</span>
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
            aria-label={ariaLabel ?? t('task.project')}
            className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
          >
            {inbox && (
              <li role="option" aria-selected={value === inbox.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (value !== inbox.id) onChange(inbox.id);
                  }}
                  className={`w-full flex items-center gap-2 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                    value === inbox.id ? 'font-medium text-brand' : ''
                  }`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0 bg-faint/40" aria-hidden="true" />
                  <span className="flex-1">{t('task.noProject')}</span>
                  {value === inbox.id && (
                    <span className="text-[12px] font-semibold">{t('task.current')}</span>
                  )}
                </button>
              </li>
            )}
            {real.map((p) => {
              const active = p.id === value;
              return (
                <li key={p.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!active) onChange(p.id);
                    }}
                    className={`w-full flex items-center gap-2 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                      active ? 'font-medium text-brand' : ''
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${colorOf(p.color).dot}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{p.name}</span>
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
