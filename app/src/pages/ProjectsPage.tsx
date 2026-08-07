import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { useData } from '@/data/data-context';
import type { Project } from '@/data/types';
import { COLUMNS } from '@/lib/constants';
import { colorOf, PROJECT_COLORS } from '@/lib/colors';
import { apiErrorText } from '@/lib/errors';

const nameSchema = z.string().trim().min(1).max(80);

const EMPTY_FORM = { name: '', emoji: '', color: 'sky' };

/** Vista Proyectos: contadores por estado + crear/editar/eliminar proyecto. */
export default function ProjectsPage() {
  const { t } = useTranslation();
  const data = useData();
  const navigate = useNavigate();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const projects = data.getProjects();
  const tasks = data.getTasks();
  const openAll = tasks.filter((tk) => tk.column !== 'hecho').length;

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const startEdit = (p: Project) => {
    setFormOpen(false);
    setEditing(p);
    setConfirmDelete(null);
    setForm({ name: p.name, emoji: p.emoji, color: p.color });
    setError(null);
  };

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
      if (editing) {
        await data.updateProject(editing.id, {
          name: parsed.data,
          emoji: form.emoji.trim(),
          color: form.color,
        });
        closeForm();
      } else {
        const project = await data.createProject({
          name: parsed.data,
          emoji: form.emoji.trim(),
          color: form.color,
        });
        closeForm();
        navigate(`/p/${project.id}`);
      }
    } catch (err) {
      setError(
        apiErrorText(err, editing ? t('projects.form.updateError') : t('projects.form.error')),
      );
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await data.deleteProject(id);
      setConfirmDelete(null);
    } catch (err) {
      setError(apiErrorText(err, t('projects.deleteError')));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
            {t('nav.projects')}
          </h1>
          <p className="text-sm text-muted mt-0.5">{t('projects.subtitle')}</p>
        </div>
        <p className="tnum text-sm text-muted">
          {t('projects.stats', { projects: projects.length, open: openAll })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:items-start">
        {projects.map((p, i) => {
          const open = p.counts.nuevo + p.counts.encurso;
          return (
            <div
              key={p.id}
              style={{ animationDelay: `${i * 50}ms` }}
              className="card rounded-2xl bg-surface border border-app shadow-soft p-4 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/p/${p.id}`)}
                  className="flex-1 min-w-0 text-left"
                  aria-label={t('projects.openBoard', { name: p.name })}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorOf(p.color).dot}`}
                      aria-hidden="true"
                    />
                    <span className="text-xl leading-none" aria-hidden="true">
                      {p.emoji}
                    </span>
                    <span className="flex-1 min-w-0 font-display font-semibold text-[16px] truncate">
                      {p.name}
                    </span>
                    <span className="tnum text-[13px] text-muted shrink-0">
                      {t('projects.open', { count: open })}
                    </span>
                    <span className="text-faint shrink-0">
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </span>
                  </span>
                  <span className="mt-2.5 pl-[22px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                    {COLUMNS.map((c, ci) => (
                      <span key={c.id} className="inline-flex items-center gap-x-2">
                        {ci > 0 && (
                          <span className="text-faint" aria-hidden="true">
                            ·
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${colorOf(c.color).dot}`}
                            aria-hidden="true"
                          />
                          <span>
                            {c.id === 'nuevo'
                              ? t('projects.nueva', { count: p.counts.nuevo })
                              : c.id === 'encurso'
                                ? t('projects.encurso', { count: p.counts.encurso })
                                : t('projects.hecha', { count: p.counts.hecho })}
                          </span>
                        </span>
                      </span>
                    ))}
                  </span>
                </button>
                <span className="flex flex-col gap-1.5 shrink-0 pt-0.5">
                  <button
                    type="button"
                    aria-label={t('projects.edit')}
                    title={t('projects.edit')}
                    onClick={() => startEdit(p)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-app bg-surface text-muted hover:text-text"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  {confirmDelete === p.id ? (
                    <span className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void remove(p.id)}
                        className="h-8 rounded-lg bg-rose-600 px-3 text-[12px] font-semibold text-white disabled:opacity-60"
                      >
                        {deleting ? t('projects.deleting') : t('common.confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="h-8 rounded-lg border border-app px-3 text-[12px] text-muted"
                      >
                        {t('common.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={t('projects.delete')}
                      title={t('projects.delete')}
                      onClick={() => setConfirmDelete(p.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-app bg-surface text-muted hover:text-rose-600 dark:hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </span>
              </div>
              {confirmDelete === p.id && (
                <p role="alert" className="mt-2 pl-[2px] text-[12px] leading-snug text-muted">
                  {t('projects.deleteWarning')}
                </p>
              )}
            </div>
          );
        })}

        {!formOpen && !editing && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="w-full sm:col-span-2 xl:col-span-3 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-app px-4 py-4 text-[14px] font-medium text-muted hover:bg-surface2"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {t('projects.new')}
          </button>
        )}

        {(formOpen || editing) && (
          <form
            onSubmit={submit}
            noValidate
            className="sm:col-span-2 xl:col-span-3 rounded-2xl bg-surface border border-app shadow-soft p-5 space-y-4"
            aria-label={t(editing ? 'projects.form.editTitle' : 'projects.form.title')}
          >
            <h2 className="font-display font-semibold text-[15px]">
              {t(editing ? 'projects.form.editTitle' : 'projects.form.title')}
            </h2>
            <div className="grid grid-cols-[1fr_88px] gap-3">
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
                <label
                  htmlFor="np-emoji"
                  className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
                >
                  {t('projects.form.emoji')}
                </label>
                <input
                  id="np-emoji"
                  type="text"
                  value={form.emoji}
                  maxLength={8}
                  onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                  placeholder={t('projects.form.emojiPlaceholder')}
                  className="w-full bg-surface2 border border-app rounded-xl px-3 py-2.5 text-[15px] text-center outline-none focus:border-brand"
                />
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
                {t('projects.form.color')}
              </p>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t('projects.form.color')}
              >
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
                onClick={closeForm}
                className="px-5 h-11 rounded-xl bg-surface2 border border-app text-[14px] font-medium text-muted hover:text-[var(--text)]"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
