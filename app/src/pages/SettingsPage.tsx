import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User,
  Users,
  Sun,
  Moon,
  Monitor,
  Globe,
  Download,
  Sparkles,
  KeyRound,
  LogOut,
  Check,
  UserPlus,
  Info,
  ExternalLink,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { z } from 'zod';
import { apiFetch, apiPost, apiPut, apiDelete, dispatchUnauthorized, ApiError } from '@/data/api-client';
import type { Language, SessionUser } from '@/data/types';
import { useSession } from '@/auth/session-context';
import { useTheme } from '@/theme/theme-context';
import type { ThemeMode } from '@/theme/theme-context';
import { applyUserLanguage } from '@/i18n';
import { Avatar } from '@/components/Avatar';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import pkg from '../../package.json';

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
/** Mini-preview de tema con los tokens reales (scope .light/.dark): prohibido hex duplicados. */
function ThemePreview({ variant }: { variant: 'light' | 'dark' }) {
  const { t } = useTranslation();
  return (
    <div className={`rounded-xl border border-app p-1.5 ${variant}`} style={{ backgroundColor: 'var(--bg)' }}>
      <div className="flex h-14 flex-col justify-between rounded-lg border border-app p-2" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-500/15 text-emerald-500">
            <Check className="w-2.5 h-2.5" aria-hidden="true" />
          </span>
          <span className="text-[8px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
            {t(variant === 'light' ? 'settings.themeLight' : 'settings.themeDark')}
          </span>
        </div>
        <div className="space-y-1">
          <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: 'var(--surface-2)' }} />
          <div className="h-1.5 w-1/2 rounded-full bg-emerald-500/60" />
        </div>
      </div>
    </div>
  );
}

function AppearanceCard() {
  const { t } = useTranslation();
  const { mode, setMode, density, setDensity, reduceMotion, setReduceMotion } = useTheme();
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
        role="radiogroup"
        aria-label={t('settings.appearance')}
      >
        {opts.map(({ m, icon: Icon, label }) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
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

      {/* Previews con tokens reales */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <ThemePreview variant="light" />
        <ThemePreview variant="dark" />
      </div>

      {/* Densidad */}
      <div className="mt-4">
        <p className="text-[13px] font-medium mb-1.5">{t('settings.density.title')}</p>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface2 p-1" role="radiogroup" aria-label={t('settings.density.title')}>
          {(['comfortable', 'compact'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={density === d}
              onClick={() => setDensity(d)}
              className={`rounded-xl py-2 text-[13px] ${density === d ? 'bg-surface shadow-soft font-medium' : 'text-muted'}`}
            >
              {t(`settings.density.${d}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Reducir animaciones */}
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-[13px]">{t('settings.reduceMotion')}</p>
        <button
          type="button"
          role="switch"
          aria-checked={reduceMotion}
          aria-label={t('settings.reduceMotion')}
          onClick={() => setReduceMotion(!reduceMotion)}
          className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${
            reduceMotion ? 'bg-emerald-500' : 'bg-surface2 border border-app'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
              reduceMotion ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>
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

  return (
    <Card>
      <Heading icon={Globe}>{t('settings.language')}</Heading>
      <p className="text-[13px] text-faint mb-3">{t('settings.langHint')}</p>
      <label className="sr-only" htmlFor="lang-select">{t('settings.language')}</label>
      <select
        id="lang-select"
        value={user.language ?? 'auto'}
        onChange={(e) => void change(e.target.value as Language)}
        className={inputCls}
      >
        <option value="auto">🌐 {t('settings.langAuto')}</option>
        <option value="es">🇪🇸 Español</option>
        <option value="en">🇬🇧 English</option>
      </select>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2">
          {error}
        </p>
      )}
    </Card>
  );
}

/* ---------------- Instalar (solo si el navegador lo soporta) ---------------- */
function InstallCard() {
  const { t } = useTranslation();
  const { state, install } = useInstallPrompt();
  if (state === 'hidden') return null;
  return (
    <Card>
      <Heading icon={Download}>{t('settings.install')}</Heading>
      {state === 'available' && (
        <button
          type="button"
          onClick={() => void install()}
          className="h-14 px-8 rounded-2xl bg-emerald-500 text-white text-[16px] font-semibold inline-flex items-center gap-2.5 hover:bg-emerald-600 shadow-soft"
        >
          <Download className="w-5 h-5" aria-hidden="true" />
          {t('settings.installButton')}
        </button>
      )}
      {state === 'installed' && (
        <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="w-4 h-4" aria-hidden="true" />
          {t('settings.installDone')}
        </p>
      )}
      {state === 'ios' && <p className="text-[13px] text-faint">{t('settings.installIosHelp')}</p>}
      {state === 'available' && <p className="text-[13px] text-faint mt-3">{t('settings.installHint')}</p>}
    </Card>
  );
}

/* ---------------- Modo demo (solo admin de producción) ---------------- */
function DemoCard() {
  const { t } = useTranslation();
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

function PasswordForm() {
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
    <form onSubmit={submit} noValidate className="space-y-4">
      {field('pw-current', t('settings.pwCurrent'), current, setCurrent, errors.current, 'current-password')}
      {field('pw-next', t('settings.pwNext'), next, setNext, errors.next, 'new-password')}
      {field('pw-confirm', t('settings.pwConfirm'), confirm, setConfirm, errors.confirm, 'new-password')}
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
  );
}

/* ---------------- Usuarios (solo admin) ---------------- */
interface AdminUser {
  id: string;
  username: string;
  language: string;
  role: 'user' | 'admin';
  color?: string | null;
}

function UsersCard() {
  const { t } = useTranslation();
  const { user: me } = useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState('es');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [pwdFor, setPwdFor] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = () =>
    apiFetch<{ users?: AdminUser[] }>('/api/users').then((d) => setUsers(d.users ?? []));

  useEffect(() => {
    reload().catch(() => setUsers([]));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !username || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ user: AdminUser }>('/api/users', { username, password, language, role });
      setUsers((us) => [...us, res.user]);
      setUsername('');
      setPassword('');
      setLanguage('es');
      setRole('user');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.users.createError'));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (id: string, r: string) => {
    setError(null);
    try {
      await apiPut(`/api/users/${id}/role`, { role: r });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.users.updateError'));
      await reload();
    }
  };

  const changeLanguage = async (id: string, l: string) => {
    setError(null);
    try {
      await apiPut(`/api/users/${id}/language`, { language: l });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.users.updateError'));
      await reload();
    }
  };

  const resetPassword = async (id: string) => {
    if (newPwd.length < 6) return;
    setError(null);
    try {
      await apiPut(`/api/users/${id}/password`, { password: newPwd });
      setPwdFor(null);
      setNewPwd('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.users.updateError'));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await apiDelete(`/api/users/${id}`);
      setConfirmDelete(null);
      setUsers((us) => us.filter((u) => u.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.users.updateError'));
      setConfirmDelete(null);
    }
  };

  const selectCls = `${inputCls} !w-auto !py-1.5 text-[13px]`;
  const iconBtnCls =
    'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-app bg-surface2 text-muted hover:text-text';

  return (
    <Card>
      <Heading icon={Users}>{t('settings.users.title')}</Heading>
      <p className="text-[13px] text-faint mb-4">{t('settings.users.subtitle')}</p>
      <ul className="space-y-2 mb-4">
        {users.map((u) => (
          <li key={u.id} className="rounded-xl border border-app bg-surface2 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Avatar name={u.username} color={u.color ?? null} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-tight truncate">
                  {u.username}
                  {u.id === me.id && (
                    <span className="ml-1.5 text-[12px] font-normal text-faint">
                      ({t('settings.users.you')})
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-faint leading-tight">
                  {u.role === 'admin' ? t('settings.users.roleAdmin') : t('settings.users.roleUser')}
                </p>
              </div>
              <select
                aria-label={t('settings.users.language')}
                value={u.language ?? 'auto'}
                onChange={(e) => void changeLanguage(u.id, e.target.value)}
                className={selectCls}
              >
                <option value="auto">🌐 Auto</option>
                <option value="es">🇪🇸 Español</option>
                <option value="en">🇬🇧 English</option>
              </select>
              {u.id !== me.id && (
                <>
                  <select
                    aria-label={t('settings.users.role')}
                    value={u.role}
                    onChange={(e) => void changeRole(u.id, e.target.value)}
                    className={selectCls}
                  >
                    <option value="user">{t('settings.users.roleUser')}</option>
                    <option value="admin">{t('settings.users.roleAdmin')}</option>
                  </select>
                  <button
                    type="button"
                    aria-label={t('settings.users.resetPassword')}
                    title={t('settings.users.resetPassword')}
                    className={iconBtnCls}
                    onClick={() => {
                      setPwdFor(pwdFor === u.id ? null : u.id);
                      setNewPwd('');
                    }}
                  >
                    <KeyRound className="w-4 h-4" aria-hidden="true" />
                  </button>
                  {confirmDelete === u.id ? (
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void remove(u.id)}
                        className="h-9 rounded-xl bg-rose-600 px-3 text-[13px] font-semibold text-white"
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="h-9 rounded-xl border border-app px-3 text-[13px] text-muted"
                      >
                        {t('common.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={t('settings.users.deleteUser')}
                      title={t('settings.users.deleteUser')}
                      className={`${iconBtnCls} hover:text-rose-600 dark:hover:text-rose-400`}
                      onClick={() => setConfirmDelete(u.id)}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </>
              )}
            </div>
            {pwdFor === u.id && (
              <form
                className="mt-3 flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void resetPassword(u.id);
                }}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder={t('settings.users.newPassword')}
                  className={`${inputCls} flex-1`}
                />
                <button
                  type="submit"
                  disabled={newPwd.length < 6}
                  className="h-[42px] rounded-xl bg-emerald-500 px-4 text-[13px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                >
                  {t('common.save')}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mb-4 text-[13px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      {!showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-app bg-surface2 px-5 text-[14px] font-semibold hover:bg-surface"
        >
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          {t('settings.users.create')}
        </button>
      ) : (
        <form onSubmit={create} className="space-y-4 border-t border-app pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="nu-username" className={labelCls}>{t('settings.users.username')}</label>
              <input id="nu-username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="nu-password" className={labelCls}>{t('settings.users.password')}</label>
              <input id="nu-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="nu-lang" className={labelCls}>{t('settings.users.language')}</label>
              <select id="nu-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
                <option value="es">🇪🇸 Español</option>
                <option value="en">🇬🇧 English</option>
              </select>
            </div>
            <div>
              <label htmlFor="nu-role" className={labelCls}>{t('settings.users.role')}</label>
              <select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} className={inputCls}>
                <option value="user">{t('settings.users.roleUser')}</option>
                <option value="admin">{t('settings.users.roleAdmin')}</option>
              </select>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-[14px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              {busy ? t('settings.users.creating') : t('settings.users.create')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setError(null);
              }}
              className="h-11 rounded-xl border border-app px-5 text-[14px] text-muted hover:bg-surface2"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

/* ---------------- Mi sesión (patrón easyzfs: 2 botones) ---------------- */
function SessionCard() {
  const { t } = useTranslation();
  const { demo } = useSession();
  const [showPwd, setShowPwd] = useState(false);

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
    <Card>
      <Heading icon={LogOut}>{t('settings.session')}</Heading>
      <div className="flex flex-wrap gap-2.5">
        {!demo && (
          <button
            type="button"
            aria-expanded={showPwd}
            onClick={() => setShowPwd((v) => !v)}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-app bg-surface2 px-5 text-[14px] font-semibold hover:bg-surface"
          >
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            {t('settings.changePassword')}
          </button>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 px-5 text-[14px] font-semibold hover:bg-rose-200/70 dark:hover:bg-rose-500/25"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          {demo ? t('demo.exit') : t('settings.logout')}
        </button>
      </div>
      {showPwd && !demo && (
        <div className="mt-4 border-t border-app pt-4">
          <PasswordForm />
        </div>
      )}
    </Card>
  );
}

/* ---------------- Acerca de ---------------- */
const REPO_URL = 'https://github.com/gnacho/deltos';

function AboutCard() {
  const { t } = useTranslation();
  const upd = useAppUpdate(pkg.version, REPO_URL);
  return (
    <Card>
      <Heading icon={Info}>{t('settings.about.title')}</Heading>
      <p className="text-[14px] font-medium">{t('settings.about.version', { version: pkg.version })}</p>
      <p className="text-[13px] text-faint mt-1">{t('settings.about.desc')}</p>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-app bg-surface2 px-3.5 text-[13px] font-medium text-muted hover:text-text"
      >
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
        {t('settings.about.source')}
      </a>

      {/* Comprobar actualizaciones: nada si no hay repo ni service worker */}
      {upd.supported && (
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {upd.swWaiting ? (
            <button
              type="button"
              onClick={upd.applySw}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-[14px] font-semibold text-white hover:bg-emerald-600"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              {t('settings.about.updateNow')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void upd.check()}
              disabled={upd.state === 'checking'}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-app bg-surface2 px-4 text-[14px] font-semibold hover:bg-surface disabled:opacity-60"
            >
              <RefreshCw
                className={`w-4 h-4 ${upd.state === 'checking' ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {upd.state === 'checking'
                ? t('settings.about.checking')
                : t('settings.about.checkUpdates')}
            </button>
          )}
          {upd.state === 'up-to-date' && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-600 dark:text-emerald-400"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              {t('settings.about.upToDate', { version: pkg.version })}
            </span>
          )}
          {upd.state === 'available' && upd.latest && (
            <>
              <span role="status" className="text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                {t('settings.about.updateAvailable', { version: upd.latest.version })}
              </span>
              <a
                href={upd.latest.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-[13px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                {t('settings.about.viewRelease')}
              </a>
            </>
          )}
          {upd.state === 'error' && (
            <span role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {t('settings.about.updateError')}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

/* ---------------- Página ---------------- */
export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, demo } = useSession();

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
        {user.role === 'admin' && !demo && <UsersCard />}
        {user.role === 'admin' && !demo && <DemoCard />}
        <SessionCard />
        <InstallCard />
        <AboutCard />
      </div>
    </div>
  );
}
