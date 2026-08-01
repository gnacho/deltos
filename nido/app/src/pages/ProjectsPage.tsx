import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Plus } from 'lucide-react';
import { z } from 'zod';
import { useData } from '@/data/data-context';
import { COLUMNS } from '@/lib/constants';
import { colorOf, PROJECT_COLORS } from '@/lib/colors';

const nameSchema = z.string().trim().min(1).max(80);

/** Vista Proyectos: contadores por estado + crear proyecto (formulario inline). */
export default function ProjectsPage() {
  const { t } = useTranslation();
  const data = useData();
  const navigate = useNavigate();

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [color, setColor] = useState('sky');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const projects = data.getProjects();
  const tasks = data.getTasks();
  const openAll = tasks.filter((tk) => tk.column !== 'hecho').length;

  const createProject = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setError(t('projects.form.nameRequired'));
      return;
    }
    setCreating(true);
    try {
      const project = await data.createProject({ name: parsed.data, emoji: emoji.trim(), color });
      setFormOpen(false);
      setName('');
      setEmoji('');
      setColor('sky');
      navigate(`/p/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.form.error'));
      setCreating(false);
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

      <div className="max-w-2xl mx-auto space-y-3">
        {projects.map((p, i) => {
          const open = p.counts.nuevo + p.counts.encurso;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/p/${p.id}`)}
              style={{ animationDelay: `${i * 50}ms` }}
              className="card w-full text-left rounded-2xl bg-surface border border-app shadow-soft p-4 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md"
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
          );
        })}

        {!formOpen ? (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-app px-4 py-4 text-[14px] font-medium text-muted hover:bg-surface2"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {t('projects.new')}
          </button>
        ) : (
          <form
            onSubmit={createProject}
            noValidate
            className="rounded-2xl bg-surface border border-app shadow-soft p-5 space-y-4"
            aria-label={t('projects.form.title')}
          >
            <h2 className="font-display font-semibold text-[15px]">{t('projects.form.title')}</h2>
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
                  value={name}
                  maxLength={80}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('projects.form.namePlaceholder')}
                  className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-emerald-500"
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
                  value={emoji}
                  maxLength={8}
                  onChange={(e) => setEmoji(e.target.value)}
                  placeholder={t('projects.form.emojiPlaceholder')}
                  className="w-full bg-surface2 border border-app rounded-xl px-3 py-2.5 text-[15px] text-center outline-none focus:border-emerald-500"
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
                  const active = color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={active}
                      aria-label={c}
                      onClick={() => setColor(c)}
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
                disabled={creating}
                className="flex-1 h-11 rounded-xl bg-emerald-500 text-white text-[14px] font-semibold hover:bg-emerald-600 disabled:opacity-60"
              >
                {creating ? t('projects.form.creating') : t('projects.form.create')}
              </button>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
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
