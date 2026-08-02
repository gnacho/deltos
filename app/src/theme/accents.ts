/**
 * Acentos de color (skill ui-appearance-system, adaptada a Tailwind).
 *
 * Fuente única de la tabla: el script prepaint de index.html es ESPEJO de
 * esta tabla (mismos hex, misma clave localStorage) — si cambias algo aquí,
 * cambia también index.html o habrá flash al cargar.
 *
 * Cada acento tiene par [color, soft] DISTINTO por tema:
 *  - color: ≥4.5:1 de contraste sobre --surface en ambos temas (se usa como
 *    texto activo en pestañas/navegación).
 *  - soft: fondo sutil de selección/badges.
 *  - El color de texto sobre el acento (--accent-fg) es blanco en claro
 *    (acentos 700) y tinta oscura en oscuro (acentos 400).
 *
 * La semántica (--ok/--warn/--danger/--info) NUNCA sigue al acento.
 */

export type AccentId = 'emerald' | 'sky' | 'violet' | 'amber';

export const ACCENT_KEY = 'deltos-accent';

/** [color, soft] en hex por tema. */
export const ACCENTS: Record<AccentId, { light: [string, string]; dark: [string, string] }> = {
  emerald: { light: ['#047857', '#d1fae5'], dark: ['#34d399', '#122a20'] },
  sky: { light: ['#0369a1', '#e0f2fe'], dark: ['#38bdf8', '#10222e'] },
  violet: { light: ['#6d28d9', '#ede9fe'], dark: ['#a78bfa', '#1e1a2e'] },
  amber: { light: ['#b45309', '#fef3c7'], dark: ['#fbbf24', '#2b2210'] },
};

export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

/** Tinta sobre el acento (botones primarios): blanco en claro, oscuro en oscuro. */
export const ACCENT_FG = { light: '#ffffff', dark: '#0c1425' } as const;

export function readAccent(): AccentId {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return v !== null && v in ACCENTS ? (v as AccentId) : 'emerald';
  } catch {
    return 'emerald';
  }
}

/** '#rrggbb' → 'r g b' (triplete para rgb(var(--x) / alpha) de Tailwind). */
export function hexToRgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Aplica el acento como variables CSS en <html> (efecto inmediato en toda la UI). */
export function applyAccent(id: AccentId, dark: boolean): void {
  const [color, soft] = dark ? ACCENTS[id].dark : ACCENTS[id].light;
  const st = document.documentElement.style;
  st.setProperty('--accent-rgb', hexToRgbTriplet(color));
  st.setProperty('--accent-soft-rgb', hexToRgbTriplet(soft));
  st.setProperty('--accent-fg-rgb', hexToRgbTriplet(dark ? ACCENT_FG.dark : ACCENT_FG.light));
}
