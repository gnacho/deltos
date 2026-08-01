import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { es as dateEs, enUS as dateEnUS } from 'date-fns/locale';
import { format } from 'date-fns';
import type { Language } from '@/data/types';
import es from './locales/es/translation.json';
import en from './locales/en/translation.json';

const LANG_MODE_KEY = 'nido-lang-mode'; // 'auto' | 'manual' (clave propia, distinta de i18nextLng)
const LANG_KEY = 'nido-lang'; // idioma elegido manualmente (caché local)

export type ResolvedLanguage = 'es' | 'en';

/** Idioma del navegador/OS reducido a los soportados. */
export function resolveAuto(): ResolvedLanguage {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'es';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function langMode(): 'auto' | 'manual' {
  try {
    return localStorage.getItem(LANG_MODE_KEY) === 'manual' ? 'manual' : 'auto';
  } catch {
    return 'auto';
  }
}

function storedManualLang(): ResolvedLanguage {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

const initial: ResolvedLanguage = langMode() === 'manual' ? storedManualLang() : resolveAuto();

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: initial,
  fallbackLng: 'es',
  interpolation: { escapeValue: false }, // React ya escapa; permite <strong> vía Trans
  returnEmptyString: false,
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

/**
 * Aplica el idioma del perfil de usuario (fuente de verdad: users.language).
 * 'auto' → navegador; 'es'/'en' → fuerza el idioma da igual el dispositivo.
 */
export function applyUserLanguage(language: Language): void {
  if (language === 'auto') {
    try {
      localStorage.setItem(LANG_MODE_KEY, 'auto');
      localStorage.removeItem(LANG_KEY);
    } catch {
      /* sin localStorage */
    }
    void i18n.changeLanguage(resolveAuto());
  } else {
    try {
      localStorage.setItem(LANG_MODE_KEY, 'manual');
      localStorage.setItem(LANG_KEY, language);
    } catch {
      /* sin localStorage */
    }
    void i18n.changeLanguage(language);
  }
}

/** date-fns locale según el idioma activo. */
export function dateLocale() {
  return i18n.language.toLowerCase().startsWith('en') ? dateEnUS : dateEs;
}

/** "3 ago" / "Aug 3" — formato corto por idioma. */
export function fmtDayMonth(d: Date): string {
  return format(d, 'd MMM', { locale: dateLocale() });
}

/** "3 ago 2026" / "Aug 3, 2026". */
export function fmtFullDate(d: Date): string {
  return i18n.language.toLowerCase().startsWith('en')
    ? format(d, 'MMM d, yyyy', { locale: dateLocale() })
    : format(d, 'd MMM yyyy', { locale: dateLocale() });
}

/** Fecha ISO YYYY-MM-DD → Date local (sin desfase de zona horaria). */
export function parseISODate(iso: string): Date {
  return new Date(iso + 'T00:00:00');
}

/** Tiempo relativo traducido ("ahora", "hace 5 min", "ayer", fecha corta). */
export function relTime(
  ts: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return t('time.now');
  const m = Math.round(s / 60);
  if (m < 60) return t('time.minutesAgo', { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('time.hoursAgo', { count: h });
  const days = Math.round(h / 24);
  if (days === 1) return t('time.yesterday');
  if (days < 7) return t('time.daysAgo', { count: days });
  return fmtDayMonth(new Date(ts));
}

export default i18n;
