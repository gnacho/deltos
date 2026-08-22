import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Check } from 'lucide-react';
import type { Subtask } from '@/data/types';
import { useData } from '@/data/data-context';

/** Bloque de subtareas de una tarea: añadir, marcar, editar inline, borrar. */
export function SubtaskList({ taskId, subtasks }: { taskId: string; subtasks: Subtask[] }) {
  const { t } = useTranslation();
  const data = useData();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Las hijas van indentadas bajo su madre (anidamiento de un nivel, simple).
  const roots = subtasks.filter((s) => s.parent_id === null);
  const childrenByParent = new Map<string, Subtask[]>();
  for (const s of subtasks) {
    if (s.parent_id) {
      const arr = childrenByParent.get(s.parent_id) ?? [];
      arr.push(s);
      childrenByParent.set(s.parent_id, arr);
    }
  }

  const add = async () => {
    if (!text.trim()) return;
    setError(null);
    setAdding(true);
    try {
      await data.addSubtask(taskId, text.trim());
      setText('');
    } catch {
      setError(t('task.subtaskAddError'));
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (s: Subtask) => {
    try {
      await data.updateSubtask(taskId, s.id, { done: !s.done });
    } catch {
      setError(t('task.subtaskUpdateError'));
    }
  };

  const saveEdit = async (s: Subtask) => {
    if (!editText.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await data.updateSubtask(taskId, s.id, { title: editText.trim() });
      setEditingId(null);
    } catch {
      setError(t('task.subtaskUpdateError'));
    }
  };

  const remove = async (s: Subtask) => {
    try {
      await data.deleteSubtask(taskId, s.id);
    } catch {
      setError(t('task.subtaskDeleteError'));
    }
  };

  const renderRow = (s: Subtask, depth: number) => (
    <li key={s.id}>
      <div
        className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-surface2/60"
        style={{ marginLeft: depth > 0 ? `${depth * 20}px` : undefined }}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={s.done}
          aria-label={t('task.subtaskToggle', { title: s.title })}
          onClick={() => void toggle(s)}
          className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
            s.done
              ? 'bg-brand border-brand text-brandfg'
              : 'border-app text-transparent hover:border-brand'
          }`}
        >
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        {editingId === s.id ? (
          <input
            autoFocus
            type="text"
            value={editText}
            maxLength={200}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={() => void saveEdit(s)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditingId(null);
            }}
            className="flex-1 min-w-0 bg-surface2 border border-app rounded-lg px-2.5 py-1 text-[14px] outline-none focus:border-brand"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => {
              setEditingId(s.id);
              setEditText(s.title);
            }}
            onClick={() => void toggle(s)}
            className={`flex-1 min-w-0 text-left text-[14px] ${s.done ? 'line-through text-faint' : ''}`}
          >
            {s.title}
          </button>
        )}

        <button
          type="button"
          onClick={() => void remove(s)}
          aria-label={t('task.subtaskDelete', { title: s.title })}
          className="w-7 h-7 shrink-0 rounded-lg text-faint hover:bg-surface2 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      {childrenByParent.get(s.id)?.map((c) => renderRow(c, depth + 1))}
    </li>
  );

  return (
    <section>
      <h3 className="font-display font-semibold text-[14px] mb-2">{t('task.subtasks')}</h3>
      {subtasks.length > 0 && (
        <ul className="space-y-0.5 mb-2">{roots.map((s) => renderRow(s, 0))}</ul>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          maxLength={200}
          placeholder={t('task.subtaskPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
          className="flex-1 min-w-0 bg-surface2 border border-app rounded-xl px-3 py-2 text-[14px] outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={adding || !text.trim()}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 text-brandfg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('task.subtaskAdd')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400 mt-1.5">
          {error}
        </p>
      )}
    </section>
  );
}
