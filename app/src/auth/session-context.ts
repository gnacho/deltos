import { createContext, useContext } from 'react';
import type { SessionUser } from '@/data/types';

export interface SessionApi {
  user: SessionUser;
  demo: boolean;
  /** Actualiza el usuario tras editar el perfil. */
  setUser: (user: SessionUser) => void;
}

export const SessionContext = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <AuthGate> autenticado');
  return ctx;
}
