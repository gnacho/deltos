import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User,
  Users,
  Sun,
  Moon,
  Monitor,
  Download,
  Sparkles,
  KeyRound,
  LogOut,
  Check,
  X,
  UserPlus,
  Info,
  ExternalLink,
  RefreshCw,
  Trash2,
  Bell,
  Tag,
  Pencil,
  Github,
  FileText,
  Heart,
  ShieldCheck,
  Database,
  Paperclip,
  HardDrive,
  Mail,
} from 'lucide-react';
import { z } from 'zod';
import { apiFetch, apiPost, apiPut, apiDelete, dispatchUnauthorized, ApiError } from '@/data/api-client';
import { apiErrorText, fieldErrors } from '@/lib/errors';
import type { Label, Language, SessionUser } from '@/data/types';
import { useSession } from '@/auth/session-context';
import { useData } from '@/data/data-context';
import { colorOf, PROJECT_COLORS } from '@/lib/colors';
import { useTheme } from '@/theme/theme-context';
import type { ThemeMode } from '@/theme/theme-context';
import { ACCENT_IDS, ACCENTS } from '@/theme/accents';
import { applyUserLanguage } from '@/i18n';
import { Avatar } from '@/components/Avatar';
import { LogoMark } from '@/components/Logo';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { usePush } from '@/hooks/usePush';
import pkg from '../../package.json';

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`settings-card rounded-2xl bg-surface border border-app shadow-soft p-5 ${className ?? ''}`}>
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
  'w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-brand';
const labelCls = 'block text-[13px] font-medium mb-1.5';

/* ---------------- Mi perfil (canónico: avatar + nombre editable + email editable + idioma + contraseña + notificaciones + logout) ---------------- */
function MiPerfilCard() {
  const { t } = useTranslation();
  const { user, setUser, demo } = useSession();
  const [showPwd, setShowPwd] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user.display_name || user.username);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(user.email || '');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const displayName = user.display_name || user.username;

  const changeLanguage = async (lang: Language) => {
    setLangError(null);
    applyUserLanguage(lang);
    try {
      const res = await apiPut<{ ok: boolean; user: SessionUser }>('/api/auth/profile', { language: lang });
      setUser(res.user);
    } catch {
      setLangError(t('settings.profileError'));
      applyUserLanguage(user.language ?? 'auto');
    }
  };

  const saveName = async () => {
    const value = nameDraft.trim();
    if (value === (user.display_name || '')) {
      setEditingName(false);
      return;
    }
    setNameBusy(true);
    setNameError(null);
    try {
      const res = await apiPut<{ ok: boolean; user: SessionUser }>('/api/auth/profile', {
        display_name: value || null,
      });
      setUser(res.user);
      setEditingName(false);
    } catch (err) {
      setNameError(apiErrorText(err, t('settings.profileError')));
    } finally {
      setNameBusy(false);
    }
  };

  const saveEmail = async () => {
    const value = emailDraft.trim();
    if (value === (user.email || '')) {
      setEditingEmail(false);
      return;
    }
    setEmailBusy(true);
    setEmailError(null);
    try {
      const res = await apiPut<{ ok: boolean; user: SessionUser }>('/api/auth/profile', {
        email: value || null,
      });
      setUser(res.user);
      setEditingEmail(false);
    } catch (err) {
      setEmailError(apiErrorText(err, t('settings.profileError')));
    } finally {
      setEmailBusy(false);
    }
  };

  const cancelName = () => {
    setNameDraft(user.display_name || user.username);
    setNameError(null);
    setEditingName(false);
  };

  const cancelEmail = () => {
    setEmailDraft(user.email || '');
    setEmailError(null);
    setEditingEmail(false);
  };

  const logout = async () => {
    try {
      await apiPost('/api/auth/logout', undefined, { noAuthEvent: true });
    } catch {
      /* la sesión local se limpia igual */
    }
    dispatchUnauthorized();
  };

  const actionBtnCls =
    'inline-flex h-9 items-center gap-1.5 rounded-lg border border-app bg-surface2 px-2.5 sm:px-3 text-[13px] font-medium text-muted transition-colors hover:bg-surface hover:text-text-primary';
  const actionTextCls = 'hidden sm:inline';

  return (
    <Card>
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        {/* Avatar */}
        <Avatar name={user.username} color={user.color} size="xl" />

        {/* Nombre + privilegios */}
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveName();
                  if (e.key === 'Escape') cancelName();
                }}
                disabled={nameBusy}
                className={inputCls + ' h-9 py-1 text-[15px]'}
                placeholder={user.username}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void saveName()}
                disabled={nameBusy}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-brandfg transition-colors hover:brightness-110 disabled:opacity-50"
                aria-label={t('common.save')}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={cancelName}
                disabled={nameBusy}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-app bg-surface2 text-muted transition-colors hover:bg-surface hover:text-text-primary"
                aria-label={t('common.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="group flex items-center gap-1.5 min-w-0"
              title={t('settings.editName')}
            >
              <p className="text-[16px] font-semibold leading-tight truncate">{displayName}</p>
              <Pencil className="w-3.5 h-3.5 text-faint opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
            </button>
          )}
          <p className="text-[13px] text-faint leading-tight mt-0.5">{t(`settings.role.${user.role}`)}</p>
          {nameError && <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400 mt-1">{nameError}</p>}
        </div>

        {/* Email + acciones agrupadas a la izquierda */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {editingEmail ? (
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveEmail();
                  if (e.key === 'Escape') cancelEmail();
                }}
                disabled={emailBusy}
                className={inputCls + ' h-9 py-1 text-[13px] w-[180px] sm:w-[220px]'}
                placeholder={t('settings.emailPlaceholder')}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void saveEmail()}
                disabled={emailBusy}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-brandfg transition-colors hover:brightness-110 disabled:opacity-50"
                aria-label={t('common.save')}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={cancelEmail}
                disabled={emailBusy}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-app bg-surface2 text-muted transition-colors hover:bg-surface hover:text-text-primary"
                aria-label={t('common.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingEmail(true)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                user.email
                  ? 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
                  : 'bg-surface2 text-faint border border-app hover:bg-surface hover:text-text-primary'
              }`}
              title={user.email ? user.email : t('settings.addEmail')}
              aria-label={user.email ? t('settings.editEmail') : t('settings.addEmail')}
            >
              <Mail className="w-4 h-4" />
            </button>
          )}

          {/* Idioma */}
          <label htmlFor="mp-lang" className="sr-only">{t('settings.language')}</label>
          <select
            id="mp-lang"
            value={user.language ?? 'auto'}
            onChange={(e) => void changeLanguage(e.target.value as Language)}
            className="h-9 w-[120px] shrink-0 rounded-lg border border-app bg-elevated px-2 text-[13px] text-text-primary outline-none focus:border-brand"
          >
            <option value="auto">🌐 {t('settings.langAuto')}</option>
            <option value="es">🇪🇸 Español</option>
            <option value="en">🇬🇧 English</option>
          </select>

          {/* Contraseña */}
          {!demo && (
            <button
              type="button"
              aria-expanded={showPwd}
              onClick={() => setShowPwd((v) => !v)}
              className={actionBtnCls}
              title={t('settings.password')}
            >
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              <span className={actionTextCls}>{t('settings.password')}</span>
            </button>
          )}

          {/* Notificaciones */}
          <button
            type="button"
            aria-expanded={showNotif}
            onClick={() => setShowNotif((v) => !v)}
            className={actionBtnCls}
            title={t('settings.notifications')}
          >
            <Bell className="w-4 h-4" aria-hidden="true" />
            <span className={actionTextCls}>{t('settings.notifications')}</span>
          </button>
        </div>

        {/* Cerrar sesión — siempre a la derecha, con texto y rojo */}
        <button
          type="button"
          onClick={() => void logout()}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger/15 shrink-0"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          {demo ? t('demo.exit') : t('settings.logout')}
        </button>
      </div>

      {emailError && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-3">
          {emailError}
        </p>
      )}

      {langError && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-3">
          {langError}
        </p>
      )}

      {showPwd && !demo && (
        <div className="mt-4 border-t border-app pt-4">
          <PasswordForm />
        </div>
      )}

      {showNotif && (
        <div className="mt-4 border-t border-app pt-4">
          <NotificationsInline />
        </div>
      )}
    </Card>
  );
}

/* ---------------- Notificaciones push (inline dentro de Mi perfil) ---------------- */
function NotificationsInline() {
  const { t } = useTranslation();
  const { soporte, estado, activar, desactivar } = usePush();

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-faint">{t('settings.notifHint')}</p>
      {estado.cargando ? null : (
        <>
          {soporte === 'requiere-https' && <p className="text-[13px] text-faint">{t('settings.notifHttps')}</p>}
          {soporte === 'no-soportado' && <p className="text-[13px] text-faint">{t('settings.notifUnsupported')}</p>}
          {soporte === 'no-configurado' && <p className="text-[13px] text-faint">{t('settings.notifNotConfigured')}</p>}
          {soporte === 'demo' && <p className="text-[13px] text-faint">{t('settings.notifDemo')}</p>}
          {soporte === 'ios-necesita-instalacion' && <p className="text-[13px] text-faint">{t('settings.notifIos')}</p>}
          {soporte === 'ok' && estado.permiso === 'denied' && (
            <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {t('settings.notifBlocked')}
            </p>
          )}
          {soporte === 'ok' && estado.permiso !== 'denied' && (
            <div className="flex items-center justify-between gap-4">
              {estado.suscrito && (
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok">
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('settings.notifEnabled')}
                </span>
              )}
              <button
                type="button"
                disabled={estado.cargando}
                onClick={() => void (estado.suscrito ? desactivar() : activar())}
                className={`${estado.suscrito ? '' : 'ml-auto '}rounded-xl px-4 py-2 text-[13px] font-semibold border transition-colors disabled:opacity-50 ${
                  estado.suscrito
                    ? 'border-app text-faint hover:text-app hover:border-strong'
                    : 'bg-brand border-brand text-brandfg hover:brightness-110'
                }`}
              >
                {estado.suscrito ? t('settings.notifDisable') : t('settings.notifEnable')}
              </button>
            </div>
          )}
          {estado.error && (
            <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {estado.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Apariencia ---------------- */
/**
 * Mini-preview de tema con los tokens reales (scope .light/.dark). El acento
 * se pinta desde la tabla ACCENTS para el tema del preview (el scope de clase
 * no puede heredar el acento vigente: redefine las variables por tema).
 */
function ThemePreview({ variant }: { variant: 'light' | 'dark' }) {
  const { t } = useTranslation();
  const { accent } = useTheme();
  const [accentColor] = variant === 'dark' ? ACCENTS[accent].dark : ACCENTS[accent].light;
  return (
    <div className={`rounded-xl border border-app p-1.5 ${variant}`} style={{ backgroundColor: 'var(--bg)' }}>
      <div className="flex h-14 flex-col justify-between rounded-lg border border-app p-2" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between">
          <span
            className="flex h-4 w-4 items-center justify-center rounded"
            style={{ backgroundColor: `${accentColor}26`, color: accentColor }}
          >
            <Check className="w-2.5 h-2.5" aria-hidden="true" />
          </span>
          <span className="text-[8px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
            {t(variant === 'light' ? 'settings.themeLight' : 'settings.themeDark')}
          </span>
        </div>
        <div className="space-y-1">
          <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: 'var(--surface-2)' }} />
          <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: `${accentColor}99` }} />
        </div>
      </div>
    </div>
  );
}

/** Selector de acento: swatches con el color real del tema efectivo (fuente única: ACCENTS). */
function AccentSwatches() {
  const { t } = useTranslation();
  const { accent, setAccent, dark } = useTheme();
  return (
    <div className="mt-4">
      <p className="text-[13px] font-medium mb-1.5">{t('settings.accent.title')}</p>
      <div className="flex items-center gap-3" role="radiogroup" aria-label={t('settings.accent.title')}>
        {ACCENT_IDS.map((id) => {
          const on = accent === id;
          const [color] = dark ? ACCENTS[id].dark : ACCENTS[id].light;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(`settings.accent.${id}`)}
              title={t(`settings.accent.${id}`)}
              onClick={() => setAccent(id)}
              className="w-7 h-7 rounded-full transition-shadow"
              style={{
                backgroundColor: color,
                boxShadow: on ? `0 0 0 2px var(--surface), 0 0 0 4px rgb(var(--accent-rgb))` : undefined,
              }}
            />
          );
        })}
      </div>
      <p className="text-[13px] text-faint mt-2">{t('settings.accent.hint')}</p>
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
    <Card className="h-full">
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

      {/* Acento */}
      <AccentSwatches />

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
            reduceMotion ? 'bg-brand' : 'bg-surface2 border border-app'
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

/* ---------------- Instalar (solo si el navegador lo soporta) ---------------- */
function InstallCard({
  state,
  install,
}: {
  state: ReturnType<typeof useInstallPrompt>['state'];
  install: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <Heading icon={Download}>{t('settings.install')}</Heading>
      {state === 'available' && (
        <button
          type="button"
          onClick={() => void install()}
          className="h-14 px-8 rounded-2xl bg-brand text-brandfg text-[16px] font-semibold inline-flex items-center gap-2.5 hover:brightness-110 shadow-soft"
        >
          <Download className="w-5 h-5" aria-hidden="true" />
          {t('settings.installButton')}
        </button>
      )}
      {state === 'installed' && (
        <p className="inline-flex items-center gap-2 rounded-full border border-ok/30 bg-ok/10 px-4 py-2 text-[13px] font-medium text-ok">
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
      setError(apiErrorText(err, t('settings.demoError')));
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
            enabled ? 'bg-brand' : 'bg-surface2 border border-app'
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
      const text = apiErrorText(err, t('settings.pwError'));
      // 422: errores por campo a partir de details.issues (zod)
      const byField = fieldErrors(err, text);
      setErrors(Object.keys(byField).length > 0 ? byField : { current: text });
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
          className="text-[13px] font-medium text-ok inline-flex items-center gap-1.5"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          {t('settings.pwChanged')}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="px-5 h-11 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110 disabled:opacity-60"
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
      setError(apiErrorText(err, t('settings.users.createError')));
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
      setError(apiErrorText(err, t('settings.users.updateError')));
      await reload();
    }
  };

  const changeLanguage = async (id: string, l: string) => {
    setError(null);
    try {
      await apiPut(`/api/users/${id}/language`, { language: l });
      await reload();
    } catch (err) {
      setError(apiErrorText(err, t('settings.users.updateError')));
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
      setError(apiErrorText(err, t('settings.users.updateError')));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await apiDelete(`/api/users/${id}`);
      setConfirmDelete(null);
      setUsers((us) => us.filter((u) => u.id !== id));
    } catch (err) {
      setError(apiErrorText(err, t('settings.users.updateError')));
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
                  className="h-[42px] rounded-xl bg-brand px-4 text-[13px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60"
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
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-[14px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60"
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


/* ---------------- Etiquetas (todos los usuarios) ---------------- */
function ColorSwatches({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (c: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {PROJECT_COLORS.map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            aria-label={c}
            title={c}
            onClick={() => onChange(c)}
            className={`w-7 h-7 rounded-full ${colorOf(c).dot} flex items-center justify-center ${
              active ? 'ring-2 ring-offset-2 ring-current ring-offset-[var(--surface)]' : 'opacity-60 hover:opacity-100'
            }`}
          >
            {active && <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function LabelsCard() {
  const { t } = useTranslation();
  const data = useData();
  const labels = data.getLabels();
  const [name, setName] = useState('');
  const [color, setColor] = useState('sky');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelError = (err: unknown) =>
    err instanceof ApiError && err.code === 'LABEL_NAME_TAKEN'
      ? t('settings.labels.nameTaken')
      : apiErrorText(err, t('settings.labels.error'));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await data.createLabel({ name: trimmed, color });
      setName('');
      setColor('sky');
    } catch (err) {
      setError(labelError(err));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (l: Label) => {
    setEditing(l.id);
    setEditName(l.name);
    setConfirmDelete(null);
    setError(null);
  };

  const saveEdit = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await data.updateLabel(id, { name: trimmed });
      setEditing(null);
    } catch (err) {
      setError(labelError(err));
    } finally {
      setBusy(false);
    }
  };

  const recolor = async (id: string, c: string) => {
    setError(null);
    try {
      await data.updateLabel(id, { color: c });
    } catch (err) {
      setError(labelError(err));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await data.deleteLabel(id);
      setConfirmDelete(null);
      if (editing === id) setEditing(null);
    } catch (err) {
      setError(labelError(err));
      setConfirmDelete(null);
    }
  };

  return (
    <Card className="h-full">
      <Heading icon={Tag}>{t('settings.labels.title')}</Heading>
      <p className="text-[13px] text-faint mb-4">{t('settings.labels.subtitle')}</p>

      {labels.length === 0 ? (
        <p className="rounded-xl border border-dashed border-app px-4 py-6 text-center text-[13px] text-muted mb-4">
          {t('settings.labels.empty')}
        </p>
      ) : (
        <ul className="space-y-2 mb-4">
          {labels.map((l) => (
            <li key={l.id} className="rounded-xl border border-app bg-surface2 px-3.5 py-2.5">
              {editing === l.id ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit(l.id);
                  }}
                >
                  <input
                    value={editName}
                    maxLength={40}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label={t('settings.labels.name')}
                    className={`${inputCls} flex-1 min-w-32`}
                  />
                  <button
                    type="submit"
                    disabled={busy || !editName.trim()}
                    className="h-9 rounded-xl bg-brand px-3 text-[13px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60"
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="h-9 rounded-xl border border-app px-3 text-[13px] text-muted"
                  >
                    {t('common.cancel')}
                  </button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-medium ${colorOf(l.color).chip}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${colorOf(l.color).dot}`} aria-hidden="true" />
                    {l.name}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    aria-label={t('settings.labels.rename')}
                    title={t('settings.labels.rename')}
                    onClick={() => startEdit(l)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-app bg-surface text-muted hover:text-text"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  {confirmDelete === l.id ? (
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void remove(l.id)}
                        className="h-8 rounded-lg bg-rose-600 px-3 text-[13px] font-semibold text-white"
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="h-8 rounded-lg border border-app px-3 text-[13px] text-muted"
                      >
                        {t('common.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={t('settings.labels.delete')}
                      title={t('settings.labels.delete')}
                      onClick={() => {
                        setConfirmDelete(l.id);
                        setEditing(null);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-app bg-surface text-muted hover:text-rose-600 dark:hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              {editing !== l.id && (
                <div className="mt-2.5">
                  <ColorSwatches
                    value={l.color}
                    onChange={(c) => void recolor(l.id, c)}
                    ariaLabel={t('settings.labels.color')}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="space-y-3 border-t border-app pt-4">
        <div>
          <label htmlFor="nl-name" className={labelCls}>
            {t('settings.labels.name')}
          </label>
          <input
            id="nl-name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.labels.namePlaceholder')}
            className={inputCls}
          />
        </div>
        <ColorSwatches value={color} onChange={setColor} ariaLabel={t('settings.labels.color')} />
        {error && (
          <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-[14px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60"
        >
          <Tag className="w-4 h-4" aria-hidden="true" />
          {busy ? t('settings.labels.creating') : t('settings.labels.create')}
        </button>
      </form>
    </Card>
  );
}

/* ---------------- Acerca de ---------------- */
const REPO_URL = 'https://github.com/gnacho/deltos';

function AboutCard() {
  const { t } = useTranslation();
  const upd = useAppUpdate(pkg.version, REPO_URL);
  const tiles: { icon: typeof Github; label: string; href?: string }[] = [
    { icon: Github, label: t('settings.about.code'), href: REPO_URL },
    { icon: FileText, label: t('settings.about.changelog'), href: `${REPO_URL}/commits/main` },
    { icon: Heart, label: t('settings.about.kofi') }, // sin href de momento (no hay cuenta)
    { icon: ShieldCheck, label: t('settings.about.privacy') },
  ];
  const tileCls =
    'flex items-center gap-2.5 rounded-xl border border-app px-3.5 py-2.5 text-[13px] font-medium text-muted transition-colors duration-150 hover:border-brand/50 hover:text-brand';
  return (
    <Card>
      <Heading icon={Info}>{t('settings.about.title')}</Heading>
      <div className="grid gap-6 md:grid-cols-2">
        {/* Izquierda: logo + nombre + versión + descripción */}
        <div className="flex items-start gap-3.5">
          <LogoMark size={48} />
          <div className="min-w-0">
            <p className="font-display font-bold text-[17px] leading-tight">{t('common.appName')}</p>
            <p className="tnum text-[12px] text-faint leading-tight mt-0.5">
              {t('settings.about.version', { version: pkg.version })}
            </p>
            <p className="text-[13px] text-faint mt-2.5 leading-relaxed">{t('settings.about.desc')}</p>
          </div>
        </div>
        {/* Derecha: tiles de enlaces (canónicos: código, cambios, ko-fi, privacidad) */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {tiles.map((item) =>
            item.href ? (
              <a key={item.label} href={item.href} target="_blank" rel="noreferrer" className={tileCls}>
                <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="leading-snug">{item.label}</span>
              </a>
            ) : (
              <div key={item.label} className={tileCls}>
                <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="leading-snug">{item.label}</span>
              </div>
            ),
          )}
        </div>
      </div>

      {/* Comprobar actualizaciones: nada si no hay repo ni service worker */}
      {upd.supported && (
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {upd.swWaiting ? (
            <button
              type="button"
              onClick={upd.applySw}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-[14px] font-semibold text-brandfg hover:brightness-110"
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
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              {t('settings.about.upToDate', { version: pkg.version })}
            </span>
          )}
          {upd.state === 'available' && upd.latest && (
            <>
              <span role="status" className="text-[13px] font-medium text-ok">
                {t('settings.about.updateAvailable', { version: upd.latest.version })}
              </span>
              <a
                href={upd.latest.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ok/40 bg-ok/10 px-3 text-[13px] font-medium text-ok"
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
      <p className="mt-5 border-t border-app pt-3 font-mono text-[12px] text-faint">
        {t('settings.about.stack')}
      </p>
    </Card>
  );
}

/* ---------------- Servidor (admin): backup + adjuntos ---------------- */
interface ServerSettings {
  backup_enabled: boolean;
  backup_retention_days: number;
  max_attachments_per_task: number;
  backup_last_run: string | null;
  backup_path: string | null;
}

function ServerSettingsCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ServerSettings>('/api/settings/server')
      .then((res) => { if (!cancelled) setSettings(res); })
      .catch(() => { if (!cancelled) setError(t('settings.server.saveError')); });
    return () => { cancelled = true; };
  }, [t]);

  const save = async (patch: Partial<ServerSettings>) => {
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiPut<ServerSettings>('/api/settings/server', {
        backup_enabled: patch.backup_enabled ?? settings.backup_enabled,
        backup_retention_days: patch.backup_retention_days ?? settings.backup_retention_days,
        max_attachments_per_task: patch.max_attachments_per_task ?? settings.max_attachments_per_task,
      });
      setSettings(updated);
    } catch (err) {
      setError(apiErrorText(err, t('settings.server.saveError')));
    } finally {
      setBusy(false);
    }
  };

  const runBackup = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    setSuccess(null);
    setError(null);
    try {
      await apiPost('/api/settings/backup/run');
      setSuccess(t('settings.server.backupDone'));
      const refreshed = await apiFetch<ServerSettings>('/api/settings/server');
      setSettings(refreshed);
    } catch (err) {
      setError(apiErrorText(err, t('settings.server.backupError')));
    } finally {
      setBackupBusy(false);
    }
  };

  if (!settings) return null;

  return (
    <Card>
      <Heading icon={HardDrive}>{t('settings.server.title')}</Heading>
      <p className="text-[13px] text-faint mb-4">{t('settings.server.subtitle')}</p>

      {/* Backup */}
      <div className="rounded-xl border border-app bg-surface2/50 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Database className="w-4.5 h-4.5 text-brand mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold">{t('settings.server.backup')}</p>
            <p className="text-[12px] text-faint mt-0.5">{t('settings.server.backupHint')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.backup_enabled}
            aria-label={t('settings.server.backupEnabled')}
            disabled={busy}
            onClick={() => void save({ backup_enabled: !settings.backup_enabled })}
            className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-50 ${
              settings.backup_enabled ? 'bg-brand' : 'bg-surface2 border border-app'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                settings.backup_enabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-3 pl-7.5">
          <label className="text-[13px] text-muted whitespace-nowrap">
            {t('settings.server.backupRetention')}
          </label>
          <input
            type="number"
            min={1}
            max={365}
            value={settings.backup_retention_days}
            onChange={(e) => {
              const v = Math.max(1, Math.min(365, parseInt(e.target.value) || 1));
              setSettings({ ...settings, backup_retention_days: v });
            }}
            onBlur={() => void save({ backup_retention_days: settings.backup_retention_days })}
            className="w-16 rounded-lg bg-surface border border-app px-2 py-1 text-[13px] text-center outline-none focus:border-brand"
          />
          <span className="text-[12px] text-faint">{t('settings.server.backupRetentionUnit')}</span>
        </div>

        <div className="pl-7.5 flex items-center justify-between gap-3">
          <p className="text-[12px] text-faint">
            {settings.backup_last_run
              ? t('settings.server.backupLastRun', { date: new Date(settings.backup_last_run).toLocaleString() })
              : t('settings.server.backupNever')}
          </p>
          <button
            type="button"
            onClick={() => void runBackup()}
            disabled={backupBusy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-50"
          >
            {backupBusy ? t('settings.server.backupRunning') : t('settings.server.backupRunNow')}
          </button>
        </div>
      </div>

      {/* Adjuntos */}
      <div className="rounded-xl border border-app bg-surface2/50 p-4 space-y-3 mt-4">
        <div className="flex items-start gap-3">
          <Paperclip className="w-4.5 h-4.5 text-brand mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold">{t('settings.server.attachments')}</p>
            <p className="text-[12px] text-faint mt-0.5">{t('settings.server.attachmentsHint')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pl-7.5">
          <label className="text-[13px] text-muted whitespace-nowrap">
            {t('settings.server.attachmentsLimit')}
          </label>
          <input
            type="number"
            min={5}
            max={50}
            value={settings.max_attachments_per_task}
            onChange={(e) => {
              const v = Math.max(5, Math.min(50, parseInt(e.target.value) || 50));
              setSettings({ ...settings, max_attachments_per_task: v });
            }}
            onBlur={() => void save({ max_attachments_per_task: settings.max_attachments_per_task })}
            className="w-16 rounded-lg bg-surface border border-app px-2 py-1 text-[13px] text-center outline-none focus:border-brand"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-3">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-[13px] font-medium text-ok mt-3">
          {success}
        </p>
      )}
    </Card>
  );
}

/* ---------------- Página ---------------- */
export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, demo } = useSession();
  const { state: installState, install } = useInstallPrompt();
  const installVisible = installState !== 'hidden';
  const isAdmin = user.role === 'admin' && !demo;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
            {t('nav.settings')}
          </h1>
          <p className="text-sm text-muted mt-0.5">{t('settings.subtitle')}</p>
        </div>
      </div>

      {/* Layout canónico (patrón NetPulse): grid 12 col, spans 7/5/12 */}
      <div className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-12">
          <MiPerfilCard />
        </div>
        <div className="lg:col-span-12 grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-2 lg:items-stretch">
          <div className="h-full">
            <AppearanceCard />
          </div>
          <div className="h-full">
            <LabelsCard />
          </div>
        </div>
        {isAdmin && (
          <>
            <div className="lg:col-span-7">
              <UsersCard />
            </div>
            <div className="lg:col-span-5 space-y-4 md:space-y-5">
              <DemoCard />
              <ServerSettingsCard />
            </div>
          </>
        )}
        {installVisible && (
          <div className="lg:col-span-12">
            <InstallCard state={installState} install={install} />
          </div>
        )}
        <div className="lg:col-span-12">
          <AboutCard />
        </div>
      </div>
    </div>
  );
}
