import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Info, Paperclip, MessageCircle, Clock } from 'lucide-react';
import { useData } from '@/data/data-context';
import type { TaskTab } from '@/components/modal-context';
import { ProjectChip } from '@/components/badges';
import { DetailsTab } from '@/components/task/DetailsTab';
import { AttachmentsTab } from '@/components/task/AttachmentsTab';
import { CommentsTab } from '@/components/task/CommentsTab';
import { ActivityTab } from '@/components/task/ActivityTab';

const TABS: { id: TaskTab; icon: typeof Info }[] = [
  { id: 'detalles', icon: Info },
  { id: 'adjuntos', icon: Paperclip },
  { id: 'comentarios', icon: MessageCircle },
  { id: 'actividad', icon: Clock },
];

/**
 * Detalle de tarea (modal, 4 pestañas). El detalle llega del DataProvider
 * (caché + refetch vía SSE); las mutaciones van por el mismo contrato.
 */
export function TaskModal({
  taskId,
  initialTab,
  onClose,
}: {
  taskId: string;
  initialTab: TaskTab;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const [tab, setTab] = useState<TaskTab>(initialTab);
  const lastFocus = useRef<Element | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /* Abrir: pide detalle fresco, guarda foco, bloquea scroll, Esc cierra */
  useEffect(() => {
    lastFocus.current = document.activeElement;
    data.refreshTaskDetail(taskId);
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
      data.releaseTaskDetail(taskId);
      const el = lastFocus.current;
      if (el instanceof HTMLElement) el.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const detail = data.getTaskDetail(taskId);
  const boardTask = data.getTask(taskId);
  const project = detail ? data.getProject(detail.task.project_id) : undefined;

  const tabCount = (id: TaskTab): number => {
    if (!detail) return 0;
    if (id === 'adjuntos') return detail.attachments.length;
    if (id === 'comentarios') return detail.comments.length;
    return 0;
  };

  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"][data-tab]');
    if (!el) return;
    e.preventDefault();
    const tabs = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"][data-tab]'),
    );
    const i = tabs.indexOf(el);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.dataset.tab as TaskTab);
    next.focus();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch lg:items-center lg:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="relative w-full h-full lg:h-auto lg:max-h-[88vh] lg:max-w-2xl xl:max-w-3xl 2xl:max-w-4xl bg-surface lg:rounded-2xl border border-app shadow-2xl overflow-y-auto nice-scroll"
      >
        {/* Cabecera fija: título + tab bar */}
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-app">
          <div className="px-5 lg:px-7 pt-4 pb-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {project && <ProjectChip project={project} />}
              <h2
                id="modal-title"
                className="font-display font-bold text-[20px] lg:text-[22px] tracking-tight leading-snug mt-2"
              >
                {detail?.task.title ?? boardTask?.title ?? ''}
              </h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center shrink-0"
              aria-label={t('task.closeDetail')}
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <div
            role="tablist"
            aria-label={t('task.tabs.label')}
            className="flex px-1 lg:px-4 overflow-x-auto no-scrollbar"
            onKeyDown={onTabKeyDown}
          >
            {TABS.map(({ id, icon: Icon }) => {
              const active = tab === id;
              const n = tabCount(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  data-tab={id}
                  aria-selected={active}
                  aria-controls={`panel-${id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(id)}
                  className={`relative flex items-center gap-2 lg:gap-1.5 px-3 lg:px-3 py-3 lg:py-2.5 -mb-px border-b-2 text-[12px] lg:text-[13px] font-medium whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-brand text-brand'
                      : 'border-transparent text-muted hover:text-[var(--text)]'
                  }`}
                >
                  <Icon className="w-6 h-6 lg:w-4 lg:h-4" aria-hidden="true" />
                  <span className="hidden lg:inline">{t(`task.tabs.${id}`)}</span>
                  {n > 0 && (
                    <span className="tnum px-1 lg:px-1.5 py-px rounded-full text-[12px] bg-surface2 text-muted">
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 lg:px-7 py-5 pb-8">
          {!detail ? (
            data.ready && !boardTask ? (
              <div className="py-12 text-center">
                <p className="text-[15px] text-muted mb-4">{t('task.notFound')}</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl bg-surface2 border border-app text-[14px] font-medium"
                >
                  {t('common.close')}
                </button>
              </div>
            ) : (
              <div className="py-12 flex justify-center" role="status">
                <p className="text-sm text-muted animate-pulse">{t('task.loading')}</p>
              </div>
            )
          ) : (
            <>
              <div
                role="tabpanel"
                id="panel-detalles"
                aria-labelledby="tab-detalles"
                tabIndex={0}
                hidden={tab !== 'detalles'}
              >
                {tab === 'detalles' && <DetailsTab detail={detail} onClose={onClose} />}
              </div>
              <div
                role="tabpanel"
                id="panel-adjuntos"
                aria-labelledby="tab-adjuntos"
                tabIndex={0}
                hidden={tab !== 'adjuntos'}
              >
                {tab === 'adjuntos' && <AttachmentsTab detail={detail} />}
              </div>
              <div
                role="tabpanel"
                id="panel-comentarios"
                aria-labelledby="tab-comentarios"
                tabIndex={0}
                hidden={tab !== 'comentarios'}
              >
                {tab === 'comentarios' && <CommentsTab detail={detail} />}
              </div>
              <div
                role="tabpanel"
                id="panel-actividad"
                aria-labelledby="tab-actividad"
                tabIndex={0}
                hidden={tab !== 'actividad'}
              >
                {tab === 'actividad' && <ActivityTab detail={detail} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
