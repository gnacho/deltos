import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useData } from '@/data/data-context';
import type { Project } from '@/data/types';
import { colorOf, PROJECT_COLORS } from '@/lib/colors';
import { apiErrorText } from '@/lib/errors';
import { PROJECT_ICONS } from '@/lib/project-icons';
import { ProjectIcon } from '@/components/ProjectIcon';

const nameSchema = z.string().trim().min(1).max(80);

/**
 * Formulario de proyecto (crear o editar). Compartido entre la vista
 * Proyectos (inline) y el tablero (modal). No decide la navegación:
 * devuelve el proyecto guardado por `onSaved`.
 */
export function ProjectForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Project | null;
  onSaved: (project: Project) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const editing = Boolean(initial);

  const [form, setForm] = useState({
    name: initial?.name ?? '',
    emoji: initial?.emoji ?? 'home',
    color: initial?.color ?? 'sky',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = nameSchema.safeParse(form.name);
    if (!parsed.success) {
      setError(t('projects.form.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await data.updateProject(initial.id, {
          name: parsed.data,
          emoji: form.emoji.trim(),
          color: form.color,
        });
        onSaved(initial);
      } else {
        const project = await data.createProject({
          name: parsed.data,
          emoji: form.emoji.trim(),
          color: form.color,
        });
        onSaved(project);
      }
    } catch (err) {
      setError(
        apiErrorText(err, editing ? t('projects.form.updateError') : t('projects.form.error')),
      );
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-4"
      aria-label={t(editing ? 'projects.form.editTitle' : 'projects.form.title')}
    >
      <div>
        <label
          htmlFor="np-name"
          className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
        >
          {t('projects.form.name')}
        </label>
        <input
          id="np-name"
          type="text"
          value={form.name}
          maxLength={80}
          autoFocus
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder={t('projects.form.namePlaceholder')}
          className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-brand"
        />
      </div>
      <div>
        <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
          {t('projects.form.icon')}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('projects.form.icon')}>
          {PROJECT_ICONS.map((ic) => {
            const active = form.emoji === ic.name;
            return (
              <button
                key={ic.name}
                type="button"
                aria-pressed={active}
                aria-label={ic.name}
                title={ic.name}
                onClick={() => setForm({ ...form, emoji: ic.name })}
                className={`h-9 w-9 rounded-lg border flex items-center justify-center transition-colors ${
                  active
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-app bg-surface2 text-muted hover:text-text hover:border-brand/40'
                }`}
              >
                <ProjectIcon name={ic.name} className="w-4.5 h-4.5" />
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
          {t('projects.form.color')}
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('projects.form.color')}>
          {PROJECT_COLORS.map((c) => {
            const active = form.color === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                aria-label={c}
                onClick={() => setForm({ ...form, color: c })}
                className={`w-8 h-8 rounded-full ${colorOf(c).dot} flex items-center justify-center ${
                  active
                    ? 'ring-2 ring-offset-2 ring-current ring-offset-[var(--surface)]'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                {active && (
                  <svg
                    className="w-4 h-4 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m4.5 12.5 5 5 10-11" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="flex gap-2.5">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 h-11 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110 disabled:opacity-60"
        >
          {saving
            ? editing
              ? t('projects.form.saving')
              : t('projects.form.creating')
            : editing
              ? t('projects.form.save')
              : t('projects.form.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 h-11 rounded-xl bg-surface2 border border-app text-[14px] font-medium text-muted hover:text-[var(--text)]"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
