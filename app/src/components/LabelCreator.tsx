import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Check } from 'lucide-react';
import type { Label } from '@/data/types';
import { useData } from '@/data/data-context';
import { colorOf, PROJECT_COLORS } from '@/lib/colors';
import { ApiError } from '@/data/api-client';
import { apiErrorText } from '@/lib/errors';

/** Chip "+" que se expande a un mini-formulario inline para crear una etiqueta. */
export function LabelCreator({ onCreated }: { onCreated?: (label: Label) => void }) {
  const { t } = useTranslation();
  const data = useData();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('sky');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setOpen(false);
    setName('');
    setColor('sky');
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const label = await data.createLabel({ name: trimmed, color });
      onCreated?.(label);
      reset();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'LABEL_NAME_TAKEN'
          ? t('task.labelExists')
          : apiErrorText(err, t('task.labelError')),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('task.newLabel')}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-surface border border-dashed border-app text-muted hover:bg-surface2"
      >
        <Plus className="w-3 h-3" aria-hidden="true" />
        {t('task.newLabel')}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className="w-full rounded-xl bg-surface2 border border-app p-2.5 space-y-2"
      aria-label={t('task.newLabel')}
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder={t('task.labelNamePlaceholder')}
          className="flex-1 min-w-0 bg-surface border border-app rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={saving || !name.trim()}
          aria-label={t('common.create')}
          className="shrink-0 w-8 h-8 rounded-lg bg-brand text-brandfg flex items-center justify-center hover:brightness-110 disabled:opacity-50"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label={t('common.cancel')}
          className="shrink-0 w-8 h-8 rounded-lg border border-app text-muted flex items-center justify-center hover:bg-surface"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('projects.form.color')}>
        {PROJECT_COLORS.map((c) => {
          const active = color === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full ${colorOf(c).dot} flex items-center justify-center ${
                active ? 'ring-2 ring-offset-2 ring-current ring-offset-[var(--surface2,var(--surface))]' : 'opacity-60 hover:opacity-100'
              }`}
            >
              {active && <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-[12px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </form>
  );
}
