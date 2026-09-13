import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Check } from 'lucide-react';

/** Editor de subtareas en memoria (modal de creación: la tarea aún no existe).
 *  Se persisten junto con la tarea al pulsar Crear. */
export function DraftSubtaskList({
  subtasks,
  onChange,
}: {
  subtasks: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  const add = () => {
    const value = text.trim();
    if (!value) return;
    onChange([...subtasks, value]);
    setText('');
  };

  return (
    <div>
      {subtasks.length > 0 && (
        <ul className="space-y-0.5 mb-2">
          {subtasks.map((s, i) => (
            <li
              key={`${i}-${s}`}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-surface2/60"
            >
              <span className="w-5 h-5 shrink-0 rounded-md border border-app flex items-center justify-center text-transparent">
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
              <span className="flex-1 min-w-0 text-[14px] break-words">{s}</span>
              <button
                type="button"
                onClick={() => onChange(subtasks.filter((_, j) => j !== i))}
                aria-label={t('task.subtaskDelete', { title: s })}
                className="w-7 h-7 shrink-0 rounded-lg text-faint hover:bg-surface2 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          maxLength={200}
          placeholder={t('task.subtaskPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1 min-w-0 bg-surface2 border border-app rounded-xl px-3 py-2 text-[14px] outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={add}
          disabled={!text.trim()}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 text-brandfg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('task.subtaskAdd')}
        </button>
      </div>
    </div>
  );
}
