import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import type { Project } from '@/data/types';
import { COLUMNS } from '@/lib/constants';
import { colorOf } from '@/lib/colors';
import { apiErrorText } from '@/lib/errors';
import { ProjectForm } from '@/components/ProjectForm';
import { ProjectIcon } from '@/components/ProjectIcon';
import { Avatar } from '@/components/Avatar';

/** ¿Puede el usuario gestionar el proyecto? (owner, admin, o legado sin owner) */
function canManage(p: Project, userId: string, isAdmin: boolean) {
  return p.owner_id == null || p.owner_id === userId || isAdmin;
}

/** Vista Proyectos: contadores por estado + crear/editar/eliminar proyecto. */
export default function ProjectsPage() {
  const { t } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const navigate = useNavigate();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const projects = data.getProjects();
  const tasks = data.getTasks();
  const openAll = tasks.filter((tk) => tk.column !== 'hecho').length;

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const startEdit = (p: Project) => {
    setFormOpen(false);
    setEditing(p);
    setConfirmDelete(null);
  };

  const remove = async (id: string) => {
    setDeleting(true);
    setError(null);
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

      {error && (
        <p role="alert" className="mb-4 text-[13px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:items-start">
        {projects.map((p, i) => {
          const open = p.counts.nuevo + p.counts.encurso;
          const manageable = canManage(p, me.id, me.role === 'admin');
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
                    <span className="w-5 h-5 shrink-0 flex items-center justify-center text-muted" aria-hidden="true">
                      <ProjectIcon name={p.emoji} className="w-5 h-5" />
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
                  {p.members.length > 1 && (
                    <span className="mt-2 pl-[22px] flex items-center gap-1">
                      {p.members.slice(0, 5).map((m) => (
                        <Avatar key={m.id} name={m.username} color={m.color} size="sm" />
                      ))}
                      {p.members.length > 5 && (
                        <span className="text-[11px] text-faint ml-0.5">
                          +{p.members.length - 5}
                        </span>
                      )}
                    </span>
                  )}
                </button>
                {manageable && (
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
                )}
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
          <div className="sm:col-span-2 xl:col-span-3 rounded-2xl bg-surface border border-app shadow-soft p-5">
            <h2 className="font-display font-semibold text-[15px] mb-4">
              {t(editing ? 'projects.form.editTitle' : 'projects.form.title')}
            </h2>
            <ProjectForm
              initial={editing}
              onSaved={(project) => {
                closeForm();
                if (!editing) navigate(`/p/${project.id}`);
              }}
              onCancel={closeForm}
            />
          </div>
        )}
      </div>
    </div>
  );
}
