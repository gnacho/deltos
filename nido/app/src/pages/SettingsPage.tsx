import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User,
  Sun,
  Moon,
  Monitor,
  Globe,
  Download,
  Sparkles,
  KeyRound,
  LogOut,
  Check,
} from 'lucide-react';
import { z } from 'zod';
import { apiFetch, apiPost, apiPut, dispatchUnauthorized, ApiError } from '@/data/api-client';
import type { Language, SessionUser } from '@/data/types';
import { useSession } from '@/auth/session-context';
import { useTheme } from '@/theme/theme-context';
import type { ThemeMode } from '@/theme/theme-context';
import { applyUserLanguage } from '@/i18n';
import { Avatar } from '@/components/Avatar';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface border border-app shadow-soft p-5">
      {children}
    </section>
  );
}

function Heading({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-display font-semibold text-[15px] mb-4">
      <span className="text-faint">
        <Icon className="w-4 h-4" aria-hidden="true" />
      </span>
      {children}
    </h2>
  );
}

const inputCls =
  'w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-emerald-500';
const labelCls = 'block text-[13px] font-medium mb-1.5';

/* ---------------- Perfil ---------------- */
function ProfileCard() {
  const { t } = useTranslation();
  const { user, setUser } = useSession();
  const [email, setEmail] = useState(user.email ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPut<{ ok: boolean; user: SessionUser }>('/api/auth/profile', {
        email: email.trim() === '' ? null : email.trim(),
      });
      setUser(res.user);
      setMsg({ ok: true, text: t('settings.profileSaved') });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : t('settings.profileError'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Heading icon={User}>{t('settings.profile')}</Heading>
      <div className="flex items-center gap-3.5 mb-5">
        <Avatar name={user.username} color={user.color} size="xl" />
        <div className="min-w-0">
          <p className="text-[16px] font-semibold leading-tight">{user.username}</p>
          <p className="text-[13px] text-faint leading-tight mt-0.5">
            {t(`settings.role.${user.role}`)}
          </p>
        </div>
      </div>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="pf-username" className={labelCls}>
            {t('settings.username')}
          </label>
          <input
            id="pf-username"
            type="text"
            value={user.username}
            disabled
            className={`${inputCls} opacity-60`}
          />
        </div>
        <div>
          <label htmlFor="pf-email" className={labelCls}>
            {t('settings.email')}
          </label>
          <input
            id="pf-email"
            type="email"
            value={email}
            maxLength={120}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('settings.emailPlaceholder')}
            className={inputCls}
          />
        </div>
        {msg && (
          <p
            role="status"
            className={`text-[13px] font-medium ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
          >
            {msg.text}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="px-5 h-11 rounded-xl bg-emerald-500 text-white text-[14px] font-semibold hover:bg-emerald-600 disabled:opacity-60"
        >
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </Card>
  );
}

/* ---------------- Apariencia ---------------- */
function AppearanceCard() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const opts: { m: ThemeMode; icon: typeof Sun; label: string }[] = [
    { m: 'auto', icon: Monitor, label: t('settings.themeAuto') },
    { m: 'light', icon: Sun, label: t('settings.themeLight') },
    { m: 'dark', icon: Moon, label: t('settings.themeDark') },
  ];
  return (
    <Card>
      <Heading icon={Sun}>{t('settings.appearance')}</Heading>
      <div
        className="grid grid-cols-3 gap-1 rounded-xl bg-surface2 p-1"
        role="group"
        aria-label={t('settings.appearance')}
      >
        {opts.map(({ m, icon: Icon, label }) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => setMode(m)}
              className={`flex flex-col items-center gap-1.5 rounded-xl py-3 text-[13px] ${
                on ? 'bg-surface shadow-soft font-medium' : 'text-muted'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-faint mt-3">{t('settings.themeHint')}</p>
    </Card>
  );
}

/* ---------------- Idioma ---------------- */
function LanguageCard() {
  const { t } = useTranslation();
  const { user, setUser } = useSession();
  const [error, setError] = useState<string | null>(null);

  const change = async (lang: Language) => {
    setError(null);
    applyUserLanguage(lang); // inmediato en la UI
    try {
      const res = await apiPut<{ ok: boolean; user: SessionUser }>('/api/auth/profile', {
        language: lang,
      });
      setUser(res.user);
    } catch {
      setError(t('settings.profileError'));
      applyUserLanguage(user.language ?? 'auto'); // revertir
    }
  };

  const opts: { value: Language; label: string }[] = [
    { value: 'auto', label: t('settings.langAuto') },
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'English' },
  ];

  return (
    <Card>
      <Heading icon={Globe}>{t('settings.language')}</Heading>
      <div
        className="grid grid-cols-3 gap-1 rounded-xl bg-surface2 p-1"
        role="group"
        aria-label={t('settings.language')}
      >
        {opts.map(({ value, label }) => {
          const on = (user.language ?? 'auto') === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => void change(value)}
              className={`rounded-xl py-3 text-[13px] ${on ? 'bg-surface shadow-soft font-medium' : 'text-muted'}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-faint mt-3">{t('settings.langHint')}</p>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2">
          {error}
        </p>
      )}
    </Card>
  );
}

/* ---------------- Instalar ---------------- */
function InstallCard() {
  const { t } = useTranslation();
  const { state, install } = useInstallPrompt();
  return (
    <Card>
      <Heading icon={Download}>{t('settings.install')}</Heading>
      <button
        type="button"
        onClick={() => void install()}
        disabled={state !== 'available'}
        className="h-14 px-8 rounded-2xl bg-emerald-500 text-white text-[16px] font-semibold inline-flex items-center gap-2.5 hover:bg-emerald-600 shadow-soft disabled:opacity-50"
      >
        {state === 'installed' ? (
          <Check className="w-5 h-5" aria-hidden="true" />
        ) : (
          <Download className="w-5 h-5" aria-hidden="true" />
        )}
        {t('settings.installButton')}
      </button>
      <p className="text-[13px] text-faint mt-3">
        {state === 'installed'
          ? t('settings.installDone')
          : state === 'unavailable'
            ? t('settings.installUnavailable')
            : t('settings.installHint')}
      </p>
    </Card>
  );
}

/* ---------------- Modo demo (solo admin de producción) ---------------- */
function DemoCard() {
  const { t } = useTranslation();
  const { demo } = useSession();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ demo_enabled: boolean }>('/api/settings/demo')
      .then((res) => {
        if (!cancelled) setEnabled(res.demo_enabled);
      })
      .catch(() => {
        if (!cancelled) setError(t('settings.demoError'));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const toggle = async () => {
    if (enabled === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPut<{ demo_enabled: boolean }>('/api/settings/demo', {
        enabled: !enabled,
      });
      setEnabled(res.demo_enabled);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.demoError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Heading icon={Sparkles}>{t('settings.demoMode')}</Heading>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-faint flex-1">{t('settings.demoHint')}</p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label={t('settings.demoMode')}
          disabled={enabled === null || busy}
          onClick={() => void toggle()}
          className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-50 ${
            enabled ? 'bg-emerald-500' : 'bg-surface2 border border-app'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>
      {demo && <p className="text-[12px] text-faint mt-2">{t('settings.demoSessionHint')}</p>}
      {error && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2">
          {error}
        </p>
      )}
    </Card>
  );
}

/* ---------------- Contraseña ---------------- */
const pwSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(6).max(100),
  confirm: z.string(),
});

function PasswordCard() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setOk(false);
    const errs: typeof errors = {};
    if (!current) errs.current = t('settings.pwRequired');
    if (next.length < 6) errs.next = t('settings.pwTooShort');
    if (next !== confirm) errs.confirm = t('settings.pwMismatch');
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const parsed = pwSchema.safeParse({ current, next, confirm });
    if (!parsed.success) return;
    setBusy(true);
    try {
      await apiPut('/api/auth/password', { current, next });
      setOk(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setErrors({ current: err instanceof ApiError ? err.message : t('settings.pwError') });
    } finally {
      setBusy(false);
    }
  };

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    error: string | undefined,
    autoComplete: string,
  ) => (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        maxLength={100}
        autoComplete={autoComplete}
        onChange={(e) => set(e.target.value)}
        aria-invalid={error !== undefined}
        className={inputCls}
      />
      {error && (
        <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400 mt-1">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <Card>
      <Heading icon={KeyRound}>{t('settings.password')}</Heading>
      <form onSubmit={submit} noValidate className="space-y-4">
        {field(
          'pw-current',
          t('settings.pwCurrent'),
          current,
          setCurrent,
          errors.current,
          'current-password',
        )}
        {field('pw-next', t('settings.pwNext'), next, setNext, errors.next, 'new-password')}
        {field(
          'pw-confirm',
          t('settings.pwConfirm'),
          confirm,
          setConfirm,
          errors.confirm,
          'new-password',
        )}
        {ok && (
          <p
            role="status"
            className="text-[13px] font-medium text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {t('settings.pwChanged')}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="px-5 h-11 rounded-xl bg-emerald-500 text-white text-[14px] font-semibold hover:bg-emerald-600 disabled:opacity-60"
        >
          {busy ? t('settings.pwSubmitting') : t('settings.pwSubmit')}
        </button>
      </form>
    </Card>
  );
}

/* ---------------- Página ---------------- */
export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, demo } = useSession();

  const logout = async () => {
    try {
      await apiPost('/api/auth/logout', undefined, { noAuthEvent: true });
    } catch {
      /* aunque falle la red, la sesión local se limpia igual */
    }
    /* Contrato: el logout despacha el MISMO evento unauthorized */
    dispatchUnauthorized();
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
            {t('nav.settings')}
          </h1>
          <p className="text-sm text-muted mt-0.5">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto space-y-4">
        <ProfileCard />
        <AppearanceCard />
        <LanguageCard />
        <InstallCard />
        {user.role === 'admin' && !demo && <DemoCard />}
        <PasswordCard />

        <button
          type="button"
          onClick={() => void logout()}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 px-4 py-3.5 text-[15px] font-semibold shadow-soft hover:bg-rose-200/70 dark:hover:bg-rose-500/25"
        >
          <LogOut className="w-[18px] h-[18px]" aria-hidden="true" />
          {t('settings.logout')}
        </button>
      </div>
    </div>
  );
}
