import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { apiFetch } from '@/data/api-client';
import { useData } from '@/data/data-context';
import { useTaskModal } from '@/components/modal-context';
import type { Task } from '@/data/types';
import { fmtDayMonth, parseISODate } from '@/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Búsqueda global (Cmd/Ctrl+K): consulta el servidor con debounce y abre la tarea. */
export default function SearchModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const data = useData();
  const { openTask } = useTaskModal();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setActive(0);
      return;
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  // Escape cierra la búsqueda aunque el foco no esté en el input. En captura y
  // con stopPropagation para que no lo consuma otro modal que esté debajo.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const id = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{ tasks: Task[] }>(`/api/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) {
          setResults(res.tasks);
          setActive(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query]);

  if (!open) return null;

  const pick = (task: Task) => {
    openTask(task.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      pick(results[active]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t('search.title')}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-app bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-app px-4">
          <Search className="w-4 h-4 shrink-0 text-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="flex-1 bg-transparent py-3.5 text-[15px] outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-faint hover:text-text"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto nice-scroll">
          {query.trim().length < 2 ? (
            <p className="px-4 py-6 text-sm text-faint">{t('search.hint')}</p>
          ) : loading ? (
            <p className="px-4 py-6 text-sm text-faint" role="status">
              {t('common.loading')}
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-faint">{t('search.noResults')}</p>
          ) : (
            <ul>
              {results.map((task, i) => {
                const project = data.getProject(task.project_id);
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(task)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${
                        i === active ? 'bg-brand-soft' : 'hover:bg-hover'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{task.title}</span>
                        <span className="block truncate text-xs text-faint">
                          {project?.name ?? t('trash.noProject')} · {t(`columns.${task.column}`)}
                          {task.due_date ? ` · ${fmtDayMonth(parseISODate(task.due_date))}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
