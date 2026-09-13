import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { dismissToast, useToasts } from '@/lib/toast-store';

/** Pila de avisos efímeros (toasts), encima del contenido y de la bottom-nav. */
export default function Toasts() {
  const { t } = useTranslation();
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[60] inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] md:bottom-6 flex flex-col items-center gap-2 px-4 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-app bg-surface px-4 py-3 shadow-2xl"
        >
          <span className="flex-1 text-sm">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                dismissToast(toast.id);
                void toast.action?.onAction();
              }}
              className="rounded-lg px-2.5 py-1 text-sm font-medium text-brand hover:bg-brand/10"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label={t('common.close')}
            className="text-faint hover:text-text"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
