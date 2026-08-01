import type { ColumnId, Priority } from '@/data/types';

export interface ColumnDef {
  id: ColumnId;
  color: string;
}

export const COLUMNS: ColumnDef[] = [
  { id: 'nuevo', color: 'sky' },
  { id: 'encurso', color: 'amber' },
  { id: 'hecho', color: 'emerald' },
];

export const COLUMN_IDS = COLUMNS.map((c) => c.id);

export const PRIORITIES: Priority[] = ['alta', 'media', 'baja'];

export const PRIORITY_BADGE: Record<Priority, string> = {
  alta: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  media: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  baja: 'bg-slate-200/70 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
};

export const PRIORITY_COLOR: Record<Priority, string> = {
  alta: 'rose',
  media: 'amber',
  baja: 'slate',
};
