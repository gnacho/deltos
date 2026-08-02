import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Sun, Moon } from 'lucide-react';
import { apiFetch, apiPost, dispatchAuthed } from '@/data/api-client';
import { apiErrorText } from '@/lib/errors';

/**
 * Fuerza el prompt "guardar contraseña" del navegador tras un login OK en SPA
 * (sin esto, al no haber recarga de página, el gestor no la ofrece).
 */
async function storeCredentials(username: string, password: string) {
  try {
    const PC = (
      window as unknown as {
        PasswordCredential?: new (d: { id: string; password: string; name?: string }) => Credential;
      }
    ).PasswordCredential;
    if ('credentials' in navigator && PC) {
      await navigator.credentials.store(new PC({ id: username, password, name: username }));
    }
  } catch {
    /* el usuario rechazó o el navegador no lo soporta: ignorar */
  }
}
import type { MeResponse } from '@/data/types';
import { LogoMark } from '@/components/Logo';
import { useTheme } from '@/theme/theme-context';

/**
 * Login: formulario user/pass con errores inline + botón "Entrar como demo"
 * (visible solo si GET /api/settings/demo lo permite).
 */
export default function Login() {
  const { t } = useTranslation();
  const { dark, toggle } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null);
  const [demoEnabled, setDemoEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ demo_enabled: boolean }>('/api/settings/demo', { noAuthEvent: true })
      .then((res) => {
        if (!cancelled) setDemoEnabled(res.demo_enabled);
      })
      .catch(() => {
        /* si falla, no se muestra el botón demo */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const doLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError(t('login.errorRequired'));
      return;
    }
    setBusy('login');
    try {
      await apiPost<MeResponse>(
        '/api/auth/login',
        { username: username.trim(), password },
        { noAuthEvent: true },
      );
      await storeCredentials(username.trim(), password);
      dispatchAuthed();
    } catch (err) {
      setError(apiErrorText(err, t('login.errorGeneric')));
      setBusy(null);
    }
  };

  const doDemo = async () => {
    setError(null);
    setBusy('demo');
    try {
      await apiPost<MeResponse>('/api/auth/demo', undefined, { noAuthEvent: true });
      dispatchAuthed();
    } catch (err) {
      setError(apiErrorText(err, t('login.errorGeneric')));
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <button
        type="button"
        onClick={toggle}
        className="fixed top-4 right-4 w-10 h-10 rounded-xl text-muted hover:bg-surface2 flex items-center justify-center"
        aria-label={dark ? t('settings.themeToLight') : t('settings.themeToDark')}
      >
        {dark ? (
          <Sun className="w-5 h-5" aria-hidden="true" />
        ) : (
          <Moon className="w-5 h-5" aria-hidden="true" />
        )}
      </button>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <LogoMark size={56} />
          <h1 className="font-display font-bold text-3xl tracking-tight mt-4">
            {t('common.appName')}
          </h1>
          <p className="text-sm text-muted mt-1.5">{t('login.subtitle')}</p>
        </div>

        <form
          onSubmit={doLogin}
          className="rounded-2xl bg-surface border border-app shadow-soft p-6 space-y-4"
          noValidate
        >
          <div>
            <label htmlFor="login-user" className="block text-[13px] font-medium mb-1.5">
              {t('login.username')}
            </label>
            <input
              id="login-user"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="login-pass" className="block text-[13px] font-medium mb-1.5">
              {t('login.password')}
            </label>
            <input
              id="login-pass"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-brand"
            />
          </div>

          {error && (
            <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy !== null}
            className="w-full h-12 rounded-xl bg-brand text-brandfg text-[15px] font-semibold hover:brightness-110 disabled:opacity-60 shadow-soft"
          >
            {busy === 'login' ? t('login.submitting') : t('login.submit')}
          </button>

          {demoEnabled && (
            <>
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="flex-1 h-px bg-[var(--border)]" />
                <span className="text-[11px] text-faint uppercase tracking-widest">·</span>
                <span className="flex-1 h-px bg-[var(--border)]" />
              </div>
              <button
                type="button"
                onClick={doDemo}
                disabled={busy !== null}
                className="w-full h-12 rounded-xl bg-surface2 border border-app text-[15px] font-semibold text-muted hover:text-[var(--text)] inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Sparkles className="w-4.5 h-4.5 w-[18px] h-[18px]" aria-hidden="true" />
                {busy === 'demo' ? t('login.submitting') : t('login.demo')}
              </button>
              <p className="text-[12px] text-faint text-center">{t('login.demoHint')}</p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
