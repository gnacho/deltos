import { useTranslation } from 'react-i18next';
import type { ColumnId } from '@/data/types';
import { COLUMNS } from '@/lib/constants';
import { colorOf } from '@/lib/colors';

/** Selector de etapa (columna) compartido por creación y edición. */
export function StageSelect({
  value,
  onChange,
  id,
}: {
  value: ColumnId;
  onChange: (column: ColumnId) => void;
  id?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      id={id}
      className="flex gap-1 rounded-full bg-surface2 p-1"
      role="group"
      aria-label={t('task.stage')}
    >
      {COLUMNS.map((c) => {
        const active = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-full px-2 h-10 text-[13px] font-medium ${
              active ? 'bg-surface shadow-soft' : 'text-muted'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${colorOf(c.color).dot}`} aria-hidden="true" />
            {t(`columns.${c.id}`)}
          </button>
        );
      })}
    </div>
  );
}
