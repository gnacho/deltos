import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[26px] items-center justify-center rounded-md border border-app bg-surface2 px-1.5 py-0.5 text-[12px] font-semibold text-text shadow-sm">
      {children}
    </kbd>
  );
}

/** Overlay "?" con la chuleta de atajos del tablero. Se cierra con Esc o ?. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const mod = /Mac|iPhone/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const rows: Array<[string, string[]]> = [
    [t('shortcuts.newTask'), ['N']],
    [t('shortcuts.openTask'), ['Enter']],
    [t('shortcuts.editTask'), ['E']],
    [t('shortcuts.navigate'), ['←', '↑', '↓', '→']],
    [t('shortcuts.search'), [mod, 'K']],
    [t('shortcuts.close'), ['Esc']],
    [t('shortcuts.openHelp'), ['?']],
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcuts.title')}
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-2xl bg-surface border border-app shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-[16px]">{t('shortcuts.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="w-9 h-9 rounded-lg text-muted hover:text-text hover:bg-surface2 flex items-center justify-center"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <ul className="space-y-2.5">
          {rows.map(([label, keys]) => (
            <li key={label} className="flex items-center justify-between gap-3">
              <span className="text-[14px] text-muted">{label}</span>
              <span className="flex items-center gap-1 shrink-0">
                {keys.map((k, i) => (
                  <Kbd key={`${k}-${i}`}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] text-faint">{t('shortcuts.mobileHint')}</p>
      </div>
    </div>
  );
}
