import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import type { Project } from '@/data/types';
import { colorOf, PROJECT_COLORS } from '@/lib/colors';
import { apiErrorText } from '@/lib/errors';
import { PROJECT_ICONS } from '@/lib/project-icons';
import { ProjectIcon } from '@/components/ProjectIcon';
import { Avatar } from '@/components/Avatar';

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
  const { user: me } = useSession();
  const editing = Boolean(initial);

  // Owner del proyecto que se edita (los miembros se gestionan a su alrededor).
  const ownerId = initial?.owner_id ?? null;

  const [form, setForm] = useState({
    name: initial?.name ?? '',
    emoji: initial?.emoji ?? 'home',
    color: initial?.color ?? 'sky',
  });
  // Miembros adicionales seleccionados (sin contar el owner). Al editar
  // arrancan desde la lista actual de miembros no-owner.
  const [memberIds, setMemberIds] = useState<Set<string>>(
    () => new Set((initial?.members ?? []).filter((m) => m.role !== 'owner').map((m) => m.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const iconRef = useRef<HTMLDivElement>(null);

  // Usuarios elegibles para añadir como miembros: todos menos el owner y yo
  // (el owner —o el creador, si es nuevo— se añade siempre en el servidor).
  const users = data.getUsers().filter((u) => u.id !== ownerId && u.id !== me.id);

  useEffect(() => {
    if (!iconOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIconOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [iconOpen]);

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
        await data.setProjectMembers(initial.id, [...memberIds]);
        onSaved(initial);
      } else {
        const project = await data.createProject({
          name: parsed.data,
          emoji: form.emoji.trim(),
          color: form.color,
          member_ids: [...memberIds],
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
        <div className="flex items-stretch gap-2">
          <input
            id="np-name"
            type="text"
            value={form.name}
            maxLength={80}
            autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('projects.form.namePlaceholder')}
            className="flex-1 min-w-0 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-brand"
          />
          <div ref={iconRef} className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="grid"
              aria-expanded={iconOpen}
              aria-label={t('projects.form.icon')}
              title={t('projects.form.icon')}
              onClick={() => setIconOpen((o) => !o)}
              className={`h-full w-11 rounded-xl border flex items-center justify-center transition-colors ${
                iconOpen
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-app bg-surface2 text-muted hover:text-text'
              }`}
            >
              <ProjectIcon name={form.emoji} className="w-5 h-5" />
            </button>
            {iconOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setIconOpen(false)} aria-hidden="true" />
                <div
                  role="grid"
                  aria-label={t('projects.form.icon')}
                  className="absolute z-30 right-0 mt-1.5 w-[320px] max-w-[80vw] p-2.5 rounded-xl bg-surface border border-app shadow-2xl"
                >
                  <div className="grid grid-cols-8 gap-1.5 max-h-64 overflow-y-auto nice-scroll">
                    {PROJECT_ICONS.map((ic) => {
                      const active = form.emoji === ic.name;
                      return (
                        <button
                          key={ic.name}
                          type="button"
                          aria-pressed={active}
                          aria-label={ic.name}
                          title={ic.name}
                          onClick={() => {
                            setForm({ ...form, emoji: ic.name });
                            setIconOpen(false);
                          }}
                          className={`h-8 w-8 rounded-lg border flex items-center justify-center transition-colors ${
                            active
                              ? 'border-brand bg-brand/10 text-brand'
                              : 'border-app bg-surface2 text-muted hover:text-text hover:border-brand/40'
                          }`}
                        >
                          <ProjectIcon name={ic.name} className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
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
      {users.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
            {t('projects.form.members')}
          </p>
          <p className="text-[12px] text-muted mb-2.5">{t('projects.form.membersHint')}</p>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={t('projects.form.members')}
          >
            {users.map((u) => {
              const active = memberIds.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const next = new Set(memberIds);
                    if (active) next.delete(u.id);
                    else next.add(u.id);
                    setMemberIds(next);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                    active
                      ? `${colorOf(u.color).chip} ring-1 ring-current font-medium`
                      : 'bg-surface border border-app text-muted hover:bg-surface2'
                  }`}
                >
                  <Avatar name={u.username} color={u.color} size="sm" />
                  {u.username}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        <button
          type="submit"
          disabled={saving}
          className="px-6 h-11 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110 disabled:opacity-60"
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
