import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, User } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { colorOf } from '@/lib/colors';

interface SelectUser {
  id: string;
  username: string;
  color: string;
}

/** Selector de asignado en desplegable (escalable a muchos usuarios). */
export function AssigneeSelect({
  users,
  value,
  onChange,
  id,
  ariaLabel,
}: {
  users: SelectUser[];
  value: string | null;
  onChange: (userId: string | null) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = users.find((u) => u.id === value) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? t('task.assignee')}
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[14px] font-medium outline-none focus:border-brand"
      >
        {selected ? (
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[13px] font-medium ${colorOf(selected.color).chip}`}
          >
            <Avatar name={selected.username} color={selected.color} />
            {selected.username}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <User className="w-4 h-4" aria-hidden="true" />
            {t('filters.unassigned')}
          </span>
        )}
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
            aria-label={ariaLabel ?? t('task.assignee')}
            className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
          >
            <li role="option" aria-selected={value === null}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (value !== null) onChange(null);
                }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                  value === null ? 'font-medium text-brand' : ''
                }`}
              >
                <User className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />
                <span className="flex-1">{t('filters.unassigned')}</span>
                {value === null && (
                  <span className="text-[12px] font-semibold">{t('task.current')}</span>
                )}
              </button>
            </li>
            {users.map((u) => {
              const active = u.id === value;
              return (
                <li key={u.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!active) onChange(u.id);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                      active ? 'font-medium text-brand' : ''
                    }`}
                  >
                    <Avatar name={u.username} color={u.color} />
                    <span className="flex-1 truncate">{u.username}</span>
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
