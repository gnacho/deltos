import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ChevronDown, Check, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useData } from '@/data/data-context';
import { DecisionModal } from '@/components/DecisionModal';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonBoard } from '@/components/Skeleton';
import { Avatar } from '@/components/Avatar';
import { colorOf } from '@/lib/colors';
import { realProjects } from '@/lib/projects';
import { apiErrorText } from '@/lib/errors';

type StatusFilter = 'all' | 'open' | 'decided';

/** Selector de proyecto: "Todas" + proyectos reales (sin el inbox). */
function ProjectPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const data = useData();
  const [open, setOpen] = useState(false);
  const projects = realProjects(data.getProjects());
  const current = value === 'all' ? null : projects.find((p) => p.id === value);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 bg-surface2 border border-app rounded-full px-3.5 h-9 text-[13px] font-medium outline-none focus:border-brand"
      >
        {current ? (
          <>
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${colorOf(current.color).dot}`}
              aria-hidden="true"
            />
            <span className="max-w-[160px] truncate">{current.name}</span>
          </>
        ) : (
          <span>{t('decisions.all')}</span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul
            role="listbox"
            aria-label={t('nav.boardSelect')}
            className="absolute z-30 left-0 mt-1.5 w-56 max-h-80 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
          >
            <li role="option" aria-selected={value === 'all'}>
              <button
                type="button"
                onClick={() => {
                  onChange('all');
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                  value === 'all' ? 'font-medium text-brand' : 'text-muted'
                }`}
              >
                <span className="flex-1">{t('decisions.all')}</span>
              </button>
            </li>
            {projects.map((p) => {
              const active = p.id === value;
              return (
                <li key={p.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${
                      active ? 'font-medium text-brand' : 'text-muted'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${colorOf(p.color).dot}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{p.name}</span>
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

/** Modal de creación: título + descripción + proyecto obligatorio. */
function NewDecisionModal({
  defaultProjectId,
  onClose,
}: {
  defaultProjectId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const projects = realProjects(data.getProjects());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    if (!projectId) {
      setError(t('decisions.form.titleLabel'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await data.createDecision({
        project_id: projectId,
        title: title.trim(),
        description: description.trim(),
      });
      onClose();
    } catch (err) {
      setError(apiErrorText(err, t('common.error')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-xl bg-surface rounded-t-2xl sm:rounded-2xl border border-app shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="shrink-0 z-10 bg-surface/95 backdrop-blur border-b border-app px-5 py-4 flex items-center gap-3">
          <h2 className="font-display font-bold text-[18px] tracking-tight flex-1">
            {t('decisions.form.createTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto nice-scroll px-5 py-5 space-y-4">
          <div>
            <label
              className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
              htmlFor="decision-title"
            >
              {t('decisions.form.titleLabel')}
            </label>
            <input
              id="decision-title"
              autoFocus
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand"
              placeholder={t('decisions.form.titlePlaceholder')}
            />
          </div>

          <div>
            <label
              className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5"
              htmlFor="decision-desc"
            >
              {t('decisions.form.descriptionLabel')}
            </label>
            <textarea
              id="decision-desc"
              value={description}
              maxLength={5000}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-brand resize-none"
              placeholder={t('decisions.form.descriptionPlaceholder')}
            />
          </div>

          <div>
            <span className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
              {t('expenses.form.project')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {projects.map((p) => {
                const active = p.id === projectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProjectId(p.id)}
                    className={`px-3 h-9 rounded-full text-[13px] font-medium border transition-colors ${
                      active
                        ? 'bg-brand text-brandfg border-brand'
                        : 'bg-surface text-muted border-app hover:text-text'
                    }`}
                  >
                    <span
                      className={`inline-block w-2 h-2 rounded-full mr-1.5 ${colorOf(p.color).dot}`}
                      aria-hidden="true"
                    />
                    {p.name}
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
        </form>

        <div className="px-5 py-4 border-t border-app">
          <button
            type="button"
            onClick={submit}
            disabled={saving || !title.trim() || !projectId}
            className="w-full h-12 rounded-xl bg-brand text-brandfg text-[15px] font-semibold hover:brightness-110 disabled:opacity-60 shadow-soft"
          >
            {saving ? t('decisions.form.creating') : t('decisions.form.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DecisionsPage() {
  const { t } = useTranslation();
  const data = useData();
  const [project, setProject] = useState<string>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const decisions = data.getDecisions();

  const filtered = useMemo(() => {
    let list = decisions;
    if (project !== 'all') list = list.filter((d) => d.project_id === project);
    if (status !== 'all') list = list.filter((d) => d.status === status);
    return list;
  }, [decisions, project, status]);

  if (!data.ready) {
    if (data.bootstrapError) {
      return (
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
          <EmptyState
            variant="error"
            title={t('common.error')}
            description={data.bootstrapError}
            cta={
              <button
                type="button"
                onClick={data.refresh}
                className="px-5 py-2.5 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110"
              >
                {t('common.retry')}
              </button>
            }
          />
        </div>
      );
    }
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
        <SkeletonBoard />
      </div>
    );
  }

  const statuses: Array<{ id: StatusFilter; label: string }> = [
    { id: 'all', label: t('decisions.all') },
    { id: 'open', label: t('decisions.open') },
    { id: 'decided', label: t('decisions.decided') },
  ];

  return (
    <div className="touch-pan-y min-h-[calc(100dvh-152px)] lg:min-h-0 lg:touch-auto">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-0 lg:pt-7">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <ProjectPicker value={project} onChange={setProject} />

          <div
            role="tablist"
            aria-label={t('decisions.title')}
            className="inline-flex items-center gap-1 rounded-full bg-surface2 p-1"
          >
            {statuses.map((s) => {
              const active = status === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatus(s.id)}
                  className={`rounded-full px-3.5 h-9 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    active ? 'bg-surface shadow-soft text-text' : 'text-muted hover:text-text'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto inline-flex items-center gap-2 rounded-2xl bg-brand text-brandfg px-5 py-2.5 text-[14px] font-semibold hover:brightness-110 shadow-soft"
            aria-label={t('decisions.new')}
          >
            <Plus className="w-5 h-5" aria-hidden="true" />
            {t('decisions.new')}
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-app px-4 py-12 text-center">
            <p className="text-[15px] text-muted">{t('decisions.empty')}</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((d) => {
              const projectInfo = data.getProject(d.project_id);
              const open = d.status === 'open';
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setDetailId(d.id)}
                    className="w-full text-left rounded-2xl border border-app bg-surface p-4 hover:shadow-soft transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display font-semibold text-[16px] leading-snug break-words">
                        {d.title}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          open
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                        }`}
                      >
                        {open ? (
                          t('decisions.statusOpen')
                        ) : (
                          <>
                            <Check className="w-3 h-3" aria-hidden="true" />
                            {t('decisions.statusDecided')}
                          </>
                        )}
                      </span>
                    </div>
                    {d.chosen_solution_title && (
                      <p className="text-[13px] text-muted mt-1.5 truncate">
                        {t('decisions.modal.chosen')}: {d.chosen_solution_title}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2 text-[13px] text-faint">
                      <Avatar name={d.created_by_username} color={d.created_by_color} size="sm" />
                      <span className="truncate">
                        {t('decisions.by', { name: d.created_by_username })}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{t('decisions.solutions', { count: d.counts.solutions })}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t('decisions.votes', { count: d.counts.votes })}</span>
                    </div>
                    {projectInfo && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${colorOf(projectInfo.color).dot}`}
                          aria-hidden="true"
                        />
                        <span className="text-[12px] text-faint truncate">{projectInfo.name}</span>
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {creating && (
        <NewDecisionModal
          defaultProjectId={project === 'all' ? null : project}
          onClose={() => setCreating(false)}
        />
      )}
      {detailId && (
        <DecisionModal
          decisionId={detailId}
          onClose={() => {
            data.releaseDecisionDetail(detailId);
            setDetailId(null);
          }}
          onDeleted={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
