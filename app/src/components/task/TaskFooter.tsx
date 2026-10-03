import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, Save } from 'lucide-react';
import { useData } from '@/data/data-context';
import { announce } from '@/lib/announce';

/** Pie del modal de tarea: estado de guardado (izquierda), acciones
 *  secundarias opcionales (slot), Eliminar con doble confirmación y los
 *  botones Cancelar / Guardar. En la pestaña Tarea el Guardar se pinta más
 *  grande y visible (prominentSave). La lógica de eliminado (armar 4 s y
 *  confirmar) vive aquí para que ambas pestañas la compartan. */
export function TaskFooter({
  taskId,
  onClose,
  saveState,
  start,
  prominentSave = false,
}: {
  taskId: string;
  onClose: () => void;
  saveState: 'idle' | 'saved' | 'error';
  start?: ReactNode;
  prominentSave?: boolean;
}) {
  const { t } = useTranslation();
  const data = useData();
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const deleteTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    },
    [],
  );

  const onDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      announce(t('task.deleteConfirm'));
      deleteTimer.current = window.setTimeout(() => setDeleteArmed(false), 4000);
      return;
    }
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    setDeleting(true);
    try {
      await data.deleteTask(taskId);
      onClose();
    } catch {
      setDeleting(false);
      setDeleteArmed(false);
      setDeleteError(true);
      window.setTimeout(() => setDeleteError(false), 4000);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-app">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => void onDelete()}
            disabled={deleting}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium transition-colors duration-150 shrink-0 ${
              deleteArmed
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 hover:bg-rose-200/70 dark:hover:bg-rose-500/25'
            } disabled:opacity-60`}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            {deleting
              ? t('task.deleting')
              : deleteArmed
                ? t('task.deleteConfirm')
                : t('task.deleteTitle')}
          </button>
          <p className="text-[12px] text-faint" role="status" aria-live="polite">
            {saveState === 'saved' && (
              <span className="inline-flex items-center gap-1 text-ok">
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                {t('task.saved')}
              </span>
            )}
            {saveState === 'error' && (
              <span className="text-rose-600 dark:text-rose-400">{t('task.saveError')}</span>
            )}
            {deleteError && (
              <span className="text-rose-600 dark:text-rose-400">{t('task.saveError')}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {start}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium bg-surface border border-app text-muted hover:text-text hover:bg-surface2 transition-colors duration-150"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={
              prominentSave
                ? 'inline-flex items-center gap-2 px-8 py-3 rounded-xl text-[16px] font-semibold bg-brand text-brandfg hover:brightness-110 hover:shadow-lg transition-all duration-150 shadow-md'
                : 'inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[14px] font-semibold bg-brand text-brandfg hover:brightness-110 hover:shadow-md transition-all duration-150 shadow-soft'
            }
          >
            <Save className={prominentSave ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden="true" />
            {t('common.save')}
          </button>
        </div>
      </div>
      {deleteArmed && <p className="text-[12px] text-faint -mt-4">{t('task.deleteHint')}</p>}
    </>
  );
}
