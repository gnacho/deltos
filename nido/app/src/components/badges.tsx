import { Calendar, ArrowUp, ArrowRight, ArrowDown, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Label, Priority, Project } from '@/data/types';
import { PRIORITY_BADGE } from '@/lib/constants';
import { colorOf } from '@/lib/colors';
import { dueInfo } from '@/lib/due';

const PR_ICON: Record<Priority, typeof ArrowUp> = {
  alta: ArrowUp,
  media: ArrowRight,
  baja: ArrowDown,
};

export function PriorityBadge({ priority, big }: { priority: Priority; big?: boolean }) {
  const { t } = useTranslation();
  const Icon = PR_ICON[priority];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${big ? 'text-[12px]' : 'text-[11px]'} ${PRIORITY_BADGE[priority]}`}
    >
      <Icon className={big ? 'w-3.5 h-3.5' : 'w-3 h-3'} aria-hidden="true" />
      {t(`priority.${priority}`)}
    </span>
  );
}

export function DueBadge({ due, big }: { due: string | null; big?: boolean }) {
  const { t } = useTranslation();
  const info = dueInfo(due);
  if (!info) return null;
  const base = `inline-flex items-center gap-1 ${big ? 'text-[13px]' : 'text-[11px]'} font-medium whitespace-nowrap`;
  const icon = <Calendar className={big ? 'w-4 h-4' : 'w-3.5 h-3.5'} aria-hidden="true" />;
  const text = info.key ? t(info.key) : info.formatted;
  if (info.kind === 'over') {
    return (
      <span
        className={`${base} px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300`}
      >
        {icon}
        {text}
      </span>
    );
  }
  if (info.kind === 'today') {
    return (
      <span
        className={`${base} px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300`}
      >
        {icon}
        {text}
      </span>
    );
  }
  return (
    <span className={`${base} text-faint`}>
      {icon}
      {text}
    </span>
  );
}

export function TagChip({ label, big }: { label: Label; big?: boolean }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full ${big ? 'text-[12px]' : 'text-[11px]'} font-medium ${colorOf(label.color).chip}`}
    >
      {label.name}
    </span>
  );
}

export function ProjectChip({ project }: { project: Project }) {
  const c = colorOf(project.color);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-medium ${c.chip}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} aria-hidden="true" />
      {project.name}
    </span>
  );
}

/** Avatar vacío "sin asignar". */
export function UnassignedAvatar({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const cls = size === 'md' ? 'w-6 h-6' : 'w-6 h-6';
  return (
    <span
      className={`${cls} rounded-full border border-dashed border-app text-faint inline-flex items-center justify-center shrink-0`}
      title={t('filters.unassigned')}
    >
      <User className="w-3 h-3" aria-hidden="true" />
    </span>
  );
}

/** Badge DEMO permanente cuando la sesión es demo. */
export function DemoBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300/60 dark:border-amber-500/40">
      {t('common.demoBadge')}
    </span>
  );
}
