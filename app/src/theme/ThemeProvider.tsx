import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext, type Density, type ThemeApi, type ThemeMode } from './theme-context';
import { ACCENT_KEY, applyAccent, readAccent, type AccentId } from './accents';

const STORAGE_KEY = 'deltos-theme';
const DENSITY_KEY = 'deltos-density';
const REDUCE_MOTION_KEY = 'deltos-reduce-motion';

function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function applyDensity(d: Density) {
  const root = document.documentElement;
  root.style.fontSize = d === 'compact' ? '13.5px' : '';
  // Palanca para reglas CSS puntuales (ver index.css, [data-density='compact'])
  if (d === 'compact') root.dataset.density = 'compact';
  else delete root.dataset.density;
}

/** Anti-FOUC: aplicar preferencias antes del primer render (main.tsx). */
export function applyBootPreferences() {
  try {
    applyDensity(readDensity());
    if (localStorage.getItem(REDUCE_MOTION_KEY) === '1') {
      document.documentElement.classList.add('reduce-motion');
    }
  } catch {
    /* sin localStorage */
  }
}
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

function readMode(): ThemeMode {
  try {
    const m = localStorage.getItem(STORAGE_KEY);
    return m === 'light' || m === 'dark' ? m : 'auto';
  } catch {
    return 'auto';
  }
}

function effectiveDark(mode: ThemeMode): boolean {
  return mode === 'dark' ? true : mode === 'light' ? false : darkMQ.matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [dark, setDark] = useState<boolean>(() => effectiveDark(readMode()));
  const [density, setDensityState] = useState<Density>(readDensity);
  const [accent, setAccentState] = useState<AccentId>(readAccent);
  const [reduceMotion, setReduceMotionState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REDUCE_MOTION_KEY) === '1';
    } catch {
      return false;
    }
  });

  const apply = useCallback((m: ThemeMode) => {
    const d = effectiveDark(m);
    setDark(d);
    document.documentElement.classList.toggle('dark', d);
  }, []);

  useEffect(() => {
    apply(mode);
  }, [mode, apply]);

  /* Acento: re-aplicar al cambiar de acento O de tema efectivo */
  useEffect(() => {
    applyAccent(accent, dark);
  }, [accent, dark]);

  const setAccent = useCallback((a: AccentId) => {
    try {
      localStorage.setItem(ACCENT_KEY, a);
    } catch {
      /* sin localStorage */
    }
    setAccentState(a);
  }, []);

  /* En modo auto, seguir al sistema en vivo */
  useEffect(() => {
    const onChange = () => {
      if (readMode() === 'auto') apply('auto');
    };
    darkMQ.addEventListener('change', onChange);
    return () => darkMQ.removeEventListener('change', onChange);
  }, [apply]);

  const setMode = useCallback((m: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* sin localStorage */
    }
    setModeState(m);
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next = effectiveDark(prev) ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* sin localStorage */
      }
      return next;
    });
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {
      /* sin localStorage */
    }
    applyDensity(d);
  }, []);

  const setReduceMotion = useCallback((v: boolean) => {
    setReduceMotionState(v);
    try {
      localStorage.setItem(REDUCE_MOTION_KEY, v ? '1' : '0');
    } catch {
      /* sin localStorage */
    }
    document.documentElement.classList.toggle('reduce-motion', v);
  }, []);

  const value = useMemo<ThemeApi>(
    () => ({
      mode,
      dark,
      setMode,
      toggle,
      accent,
      setAccent,
      density,
      setDensity,
      reduceMotion,
      setReduceMotion,
    }),
    [mode, dark, setMode, toggle, accent, setAccent, density, setDensity, reduceMotion, setReduceMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
