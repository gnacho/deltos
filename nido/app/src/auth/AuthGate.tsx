import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/data/api-client';
import type { MeResponse, SessionUser } from '@/data/types';
import { applyUserLanguage } from '@/i18n';
import { SessionContext, type SessionApi } from './session-context';
import Login from '@/pages/Login';

type GateState = 'loading' | 'login' | 'authed';

/**
 * AuthGate: loading → login → app.
 * Contrato de eventos (base común):
 *  - `nido-authed` (login OK) → refetch /me y entra
 *  - `nido-unauthorized` (401 o logout) → vuelve a login
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [demo, setDemo] = useState(false);

  const fetchMe = useCallback(async (): Promise<boolean> => {
    try {
      const me = await apiFetch<MeResponse>('/api/auth/me', { noAuthEvent: true });
      setUser(me.user);
      setDemo(me.demo);
      applyUserLanguage(me.user.language ?? 'auto');
      return true;
    } catch {
      setUser(null);
      setDemo(false);
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await fetchMe();
      if (!cancelled) setState(ok ? 'authed' : 'login');
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  useEffect(() => {
    const onAuthed = () => {
      void fetchMe().then((ok) => setState(ok ? 'authed' : 'login'));
    };
    const onUnauthorized = () => {
      setUser(null);
      setDemo(false);
      setState('login');
    };
    window.addEventListener('nido-authed', onAuthed);
    window.addEventListener('nido-unauthorized', onUnauthorized);
    return () => {
      window.removeEventListener('nido-authed', onAuthed);
      window.removeEventListener('nido-unauthorized', onUnauthorized);
    };
  }, [fetchMe]);

  const session = useMemo<SessionApi | null>(
    () => (user ? { user, demo, setUser } : null),
    [user, demo],
  );

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status">
        <div className="flex flex-col items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-soft">
            <svg
              className="w-5 h-5 animate-pulse"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m4.5 12.5 5 5 10-11" />
            </svg>
          </span>
          <p className="text-sm text-muted">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (state === 'login' || !session) {
    return <Login />;
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
