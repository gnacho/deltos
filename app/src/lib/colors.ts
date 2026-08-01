/** Paleta compartida (mockup): dot / chip / avatar por color. */

export interface ColorSet {
  dot: string;
  chip: string;
}

export const COLORS: Record<string, ColorSet> = {
  sky: { dot: 'bg-sky-500', chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  blue: {
    dot: 'bg-blue-500',
    chip: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  },
  amber: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  emerald: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  rose: {
    dot: 'bg-rose-500',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
  violet: {
    dot: 'bg-violet-500',
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
  cyan: {
    dot: 'bg-cyan-500',
    chip: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  },
  pink: {
    dot: 'bg-pink-500',
    chip: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  },
  slate: {
    dot: 'bg-slate-400',
    chip: 'bg-slate-200/70 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
  },
  teal: {
    dot: 'bg-teal-500',
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  },
};

export const COLOR_KEYS = Object.keys(COLORS);

const FALLBACK: ColorSet = COLORS.slate;

export function colorOf(name: string | null | undefined): ColorSet {
  return (name && COLORS[name]) || FALLBACK;
}

/** Acento RGB por columna (placeholder/highlight del DnD). */
export const COLUMN_ACCENT_RGB: Record<string, string> = {
  sky: '14 165 233',
  amber: '245 158 11',
  emerald: '16 185 129',
};

/** Avatar con color de usuario (bg suave + texto). */
export function avatarClass(color: string | null | undefined): string {
  const c = colorOf(color);
  return c.chip;
}

export const PROJECT_COLORS = [
  'sky',
  'blue',
  'amber',
  'emerald',
  'rose',
  'violet',
  'cyan',
  'pink',
  'teal',
  'slate',
];
