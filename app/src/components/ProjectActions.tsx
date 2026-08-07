import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Trash2 } from 'lucide-react';
import { useData } from '@/data/data-context';
import type { Project } from '@/data/types';
import { ProjectForm } from '@/components/ProjectForm';
import { ProjectIcon } from '@/components/ProjectIcon';
import { apiErrorText } from '@/lib/errors';

/**
 * Acciones de proyecto desde el tablero. La hamburguesa del board abre
 * DIRECTAMENTE la edición (nombre, emoji, color); al pie de esa tarjeta hay
 * una zona de peligro "Eliminar proyecto" que pide confirmación. Borrar un
 * proyecto elimina también sus tareas (cascada): se avisa y se sugiere
 * reasignar las tareas a otro proyecto antes si se quieren conservar.
 * Tras borrar navega a `/` porque el proyecto ya no existe.
 */
export function ProjectActions({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    lastFocus.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      const el = lastFocus.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, [onClose]);

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await data.deleteProject(project.id);
      onClose();
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      setDeleteError(apiErrorText(err, t('projects.deleteError')));
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('projects.edit')}
    >
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-[420px] rounded-2xl bg-surface border border-app shadow-xl p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display font-semibold text-[16px] truncate inline-flex items-center gap-2">
            <ProjectIcon name={project.emoji} className="w-4.5 h-4.5 text-muted shrink-0" />
            {project.name}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="h-9 w-9 shrink-0 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center border border-app"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {!confirming ? (
          <>
            <ProjectForm initial={project} onSaved={onClose} onCancel={onClose} />
            {/* Zona de peligro */}
            <div className="mt-5 border-t border-app pt-4">
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="flex items-center justify-center gap-2 w-full rounded-xl px-3.5 py-2.5 text-[14px] font-semibold bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                {t('projects.delete')}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-muted">
              {t('projects.deleteWarning')}
            </p>
            {deleteError && (
              <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
                {deleteError}
              </p>
            )}
            <div className="flex gap-2.5">
              <button
                type="button"
                disabled={deleting}
                onClick={() => void remove()}
                className="flex-1 h-11 rounded-xl bg-rose-600 text-white text-[14px] font-semibold hover:brightness-110 disabled:opacity-60"
              >
                {deleting ? t('projects.deleting') : t('projects.deleteConfirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="px-5 h-11 rounded-xl bg-surface2 border border-app text-[14px] font-medium text-muted hover:text-[var(--text)]"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
