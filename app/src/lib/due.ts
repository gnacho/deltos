import { parseISODate, fmtDayMonth } from '@/i18n';

export type DueKind = 'over' | 'today' | 'normal';

export interface DueInfo {
  kind: DueKind;
  /** Clave i18n o texto ya formateado. */
  key: 'due.yesterday' | 'due.overdue' | 'due.today' | 'due.tomorrow' | null;
  formatted: string | null;
}

export function dueInfo(due: string | null | undefined): DueInfo | null {
  if (!due) return null;
  const d = parseISODate(due);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 864e5);
  if (diff < 0)
    return { kind: 'over', key: diff === -1 ? 'due.yesterday' : 'due.overdue', formatted: null };
  if (diff === 0) return { kind: 'today', key: 'due.today', formatted: null };
  if (diff === 1) return { kind: 'normal', key: 'due.tomorrow', formatted: null };
  return { kind: 'normal', key: null, formatted: fmtDayMonth(d) };
}
