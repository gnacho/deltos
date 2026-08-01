import { createContext, useContext } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';

export type Density = 'comfortable' | 'compact';

export interface ThemeApi {
  mode: ThemeMode;
  /** Tema efectivamente aplicado. */
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
  /** Toggle rápido del header: fuerza claro/oscuro explícito. */
  toggle: () => void;
  density: Density;
  setDensity: (d: Density) => void;
  reduceMotion: boolean;
  setReduceMotion: (v: boolean) => void;
}

export const ThemeContext = createContext<ThemeApi | null>(null);

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}
