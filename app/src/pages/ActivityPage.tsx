import { useTranslation } from 'react-i18next';
import ActivityFeed from '@/components/ActivityFeed';

/** Vista Actividad: feed global con paginación keyset, agrupado por día. */
export default function ActivityPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
            {t('nav.activity')}
          </h1>
          <p className="text-sm text-muted mt-0.5">{t('activityPage.subtitle')}</p>
        </div>
      </div>

      <ActivityFeed />
    </div>
  );
}
