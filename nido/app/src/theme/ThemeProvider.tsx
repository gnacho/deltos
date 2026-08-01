import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext, type ThemeApi, type ThemeMode } from './theme-context';

const STORAGE_KEY = 'nido-theme';
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

  const apply = useCallback((m: ThemeMode) => {
    const d = effectiveDark(m);
    setDark(d);
    document.documentElement.classList.toggle('dark', d);
  }, []);

  useEffect(() => {
    apply(mode);
  }, [mode, apply]);

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

  const value = useMemo<ThemeApi>(
    () => ({ mode, dark, setMode, toggle }),
    [mode, dark, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
