import { useTranslation } from 'react-i18next';
import { useData } from '@/data/data-context';

/** Estado de conexión SSE: puntito "en vivo" / "reconectando". */
export function ConnectionDot({ withLabel = true }: { withLabel?: boolean }) {
  const { t } = useTranslation();
  const { connectionStatus } = useData();
  const live = connectionStatus === 'connected';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-faint"
      role="status"
      aria-label={live ? t('connection.live') : t('connection.reconnecting')}
    >
      <span className="relative flex w-2 h-2">
        {!live && (
          <span className="absolute inline-flex w-full h-full rounded-full bg-amber-400 opacity-75 animate-ping" />
        )}
        <span
          className={`relative inline-flex w-2 h-2 rounded-full ${live ? 'bg-ok' : 'bg-amber-400'}`}
        />
      </span>
      {withLabel && (live ? t('connection.live') : t('connection.reconnecting'))}
    </span>
  );
}
