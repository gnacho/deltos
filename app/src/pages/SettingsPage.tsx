import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import * as React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  User,
  Sun,
  Moon,
  Monitor,
  Download,
  KeyRound,
  Languages,
  LogOut,
  Check,
  X,
  Info,
  Bell,
  Tag,
  Pencil,
  Github,
  FileText,
  Heart,
  ShieldCheck,
  Mail,
  Trash2,
} from 'lucide-react';
import { z } from 'zod';
import { apiFetch, apiPost, apiPut, dispatchUnauthorized, ApiError } from '@/data/api-client';
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
import { CheckToggle } from '@/components/CheckToggle';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { usePush } from '@/hooks/usePush';
import AdminBar from './AdminBar';
import pkg from '../../package.json';

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`settings-card rounded-2xl bg-surface border border-app shadow-soft p-5 ${className ?? ''}`}>
      {children}
    </section>
  );
}

function Heading({ icon: Icon, children, title }: { icon: typeof User; children: React.ReactNode; title?: string }) {
  return (
    <h2 className="flex items-center gap-2 font-display font-semibold text-[15px] mb-4" title={title}>
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
    <motion.section
      initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="w-full rounded-2xl border border-app bg-surface p-5"
    >
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 min-w-0">
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
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
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

          {/* Idioma — icono en móvil, select completo en desktop */}
          <label htmlFor="mp-lang" className="sm:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-app text-faint cursor-pointer hover:bg-surface hover:text-text-primary" title={t('settings.language')}>
            <Languages className="h-4 w-4" />
          </label>
          <select
            id="mp-lang"
            value={user.language ?? 'auto'}
            onChange={(e) => void changeLanguage(e.target.value as Language)}
            className="hidden sm:inline h-9 w-[120px] shrink-0 rounded-lg border border-app bg-elevated px-2 text-[13px] text-text-primary outline-none focus:border-brand"
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

        {/* Cerrar sesión — siempre a la derecha, rojo; texto solo en ≥sm */}
        <button
          type="button"
          onClick={() => void logout()}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-2.5 sm:px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger/15 shrink-0"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          <span className={actionTextCls}>{demo ? t('demo.exit') : t('settings.logout')}</span>
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
    </motion.section>
  );
}

/* ---------------- Notificaciones push (inline dentro de Mi perfil) ---------------- */
function NotificationsInline() {
  const { t } = useTranslation();
  const { soporte, estado, activar, desactivar } = usePush();
  const TIPOS = ['asignacion', 'comentario', 'tarea_movida', 'mencion', 'vencimiento'] as const;
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    apiFetch<{ prefs: Record<string, boolean> }>('/api/push/preferences')
      .then((r) => setPrefs(r.prefs))
      .catch(() => setPrefs(null));
  }, []);

  const cambiarPref = (tipo: string, enabled: boolean) => {
    setPrefs((p) => (p ? { ...p, [tipo]: enabled } : p));
    apiPut('/api/push/preferences', { tipo, enabled }).catch(() => {
      setPrefs((p) => (p ? { ...p, [tipo]: !enabled } : p));
    });
  };

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
          {estado.suscrito && prefs && (
            <div className="space-y-2 border-t border-app pt-3">
              <p className="text-[13px] font-medium text-faint">{t('settings.notifTipos')}</p>
              {TIPOS.map((tipo) => (
                <div key={tipo} className="flex items-center justify-between gap-3">
                  <CheckToggle
                    checked={prefs[tipo] !== false}
                    onChange={(checked) => cambiarPref(tipo, checked)}
                    label={t(`settings.notifTipo.${tipo}`)}
                    variant="switch"
                    size="sm"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Apariencia (canónica 10-Ago-2026) ---------------- */

/** Colores fijos de los temas para los previews (fuente única: index.css). */
const THEME_BG = { light: '#F4F6FA', dark: '#080D1A' } as const;
const THEME_SURFACE = { light: '#FFFFFF', dark: '#101828' } as const;
const THEME_BAR = { light: '#EEF1F6', dark: '#182338' } as const;

/** Mitad del preview 'split': un lado del tema con sus tokens reales. */
function PreviewBlock({ useLight }: { useLight: boolean }) {
  const bgC = useLight ? THEME_BG.light : THEME_BG.dark;
  const surfaceC = useLight ? THEME_SURFACE.light : THEME_SURFACE.dark;
  const barC = useLight ? THEME_BAR.light : THEME_BAR.dark;
  return (
    <div className="flex w-1/2 flex-col p-1.5" style={{ backgroundColor: bgC }}>
      <div className="mb-1 h-1.5 w-full rounded" style={{ backgroundColor: barC }} />
      <div className="flex flex-1 gap-1">
        <div className="w-1/4 rounded" style={{ backgroundColor: barC }} />
        <div className="flex flex-1 flex-col gap-1">
          <div className="h-2 w-3/4 rounded bg-brand/60" />
          <div className="h-4 flex-1 rounded" style={{ backgroundColor: surfaceC }} />
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ variant }: { variant: 'light' | 'dark' | 'auto' }) {
  if (variant === 'auto') {
    return (
      <div className="flex h-[80px] w-full overflow-hidden rounded-lg border border-app">
        <PreviewBlock useLight={false} />
        <PreviewBlock useLight />
      </div>
    );
  }
  const { bg, surface, bar } = variant === 'dark'
    ? { bg: THEME_BG.dark, surface: THEME_SURFACE.dark, bar: THEME_BAR.dark }
    : { bg: THEME_BG.light, surface: THEME_SURFACE.light, bar: THEME_BAR.light };
  return (
    <div className="flex h-[80px] w-full flex-col rounded-lg border border-app p-1.5" style={{ backgroundColor: bg }}>
      <div className="mb-1 h-1.5 w-full rounded" style={{ backgroundColor: bar }} />
      <div className="flex flex-1 gap-1">
        <div className="w-1/4 rounded" style={{ backgroundColor: bar }} />
        <div className="flex flex-1 flex-col gap-1">
          <div className="h-2 w-3/4 rounded bg-brand/60" />
          <div className="h-4 flex-1 rounded" style={{ backgroundColor: surface }} />
        </div>
      </div>
    </div>
  );
}

/** Swatches de acento con colores del tema actual (fuente única: ACCENTS). */
function AccentSwatches() {
  const { t } = useTranslation();
  const { accent, setAccent, dark } = useTheme();
  return (
    <div role="radiogroup" aria-label={t('settings.accent.title')} className="flex items-center gap-2">
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
            className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110${
              on ? ' ring-2 ring-brand ring-offset-2' : ''
            }`}
            style={{ backgroundColor: color, ...(on ? { '--tw-ring-offset-color': 'var(--surface)' } as React.CSSProperties : {}) }}
          >
            {on && <Check size={12} strokeWidth={3} className="text-white" />}
          </button>
        );
      })}
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
      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        {/* Tiles de tema (máx 50% ancho) */}
        <div role="radiogroup" aria-label={t('settings.appearance')} className="grid grid-cols-3 gap-2 md:w-1/2 md:flex-shrink-0">
          {opts.map(({ m, icon: Icon, label }) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(m)}
                className={`group relative flex flex-col gap-2 rounded-xl border-2 p-2 transition-all${
                  active ? ' border-brand bg-brand/5' : ' border-app hover:border-brand/30'
                }`}
              >
                <ThemePreview variant={m === 'auto' ? 'auto' : m} />
                <div className="flex items-center justify-center gap-1.5">
                  <Icon size={14} className={active ? 'text-brand' : 'text-faint'} />
                  <span className={`text-xs font-medium${active ? ' text-brand' : ' text-faint'}`}>{label}</span>
                </div>
                {active && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Controles: acento + animaciones en línea, densidad debajo */}
        <div className="flex flex-col gap-3 md:flex-1">
          {/* Acento y Animaciones en línea */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{t('settings.accent.title')}</p>
            <div className="flex items-center gap-3">
              <AccentSwatches />
              <CheckToggle
                checked={!reduceMotion}
                onChange={(v) => setReduceMotion(!v)}
                label={t('settings.reduceMotion')}
                variant="switch"
                className="ml-auto"
              />
            </div>
          </div>

          {/* Densidad */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{t('settings.density.title')}</p>
            <div role="radiogroup" aria-label={t('settings.density.title')} className="flex rounded-xl border border-app bg-surface2 p-0.5">
              {(['comfortable', 'compact'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={density === d}
                  onClick={() => setDensity(d)}
                  className={`h-8 flex-1 rounded-lg text-[13px] transition-colors${
                    density === d ? ' bg-surface shadow-soft font-semibold text-text' : ' text-faint hover:text-muted'
                  }`}
                >
                  {t(`settings.density.${d}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Modo demo (solo admin de producción) ---------------- */
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
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
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
  const [editColor, setEditColor] = useState('sky');
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
    setEditColor(l.color);
    setConfirmDelete(null);
    setError(null);
  };

  const saveEdit = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await data.updateLabel(id, { name: trimmed, color: editColor });
      setEditing(null);
    } catch (err) {
      setError(labelError(err));
    } finally {
      setBusy(false);
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
    <Card>
      <Heading icon={Tag} title={t('settings.labels.subtitle')}>{t('settings.labels.title')}</Heading>
      {labels.length === 0 ? null : (
        <ul className="space-y-1.5 mb-4">
          {labels.map((l) => (
            <li key={l.id} className="rounded-lg border border-app bg-surface2 px-3 py-2">
              {editing === l.id ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={editName} maxLength={40} autoFocus onChange={(e) => setEditName(e.target.value)}
                      aria-label={t('settings.labels.name')} className={`${inputCls} flex-1 min-w-32`} />
                    <button type="submit" onClick={(e) => { e.preventDefault(); void saveEdit(l.id); }} disabled={busy || !editName.trim()}
                      className="h-8 rounded-lg bg-brand px-3 text-[12px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60">
                      {t('common.save')}
                    </button>
                    <button type="button" onClick={() => setEditing(null)}
                      className="h-8 rounded-lg border border-app px-3 text-[12px] text-muted">
                      {t('common.cancel')}
                    </button>
                  </div>
                  <ColorSwatches value={editColor} onChange={setEditColor} ariaLabel={t('settings.labels.color')} />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${colorOf(l.color).chip}`}>
                      <span className={`w-1 h-1 rounded-full ${colorOf(l.color).dot}`} aria-hidden="true" />
                      {l.name}
                    </span>
                    <span className="flex-1" />
                    <button type="button" aria-label={t('settings.labels.rename')} title={t('settings.labels.rename')}
                      onClick={() => startEdit(l)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-app bg-surface text-muted hover:text-text">
                      <Pencil className="w-3 h-3" aria-hidden="true" />
                    </button>
                    {confirmDelete === l.id ? (
                      <span className="flex gap-1">
                        <button type="button" onClick={() => void remove(l.id)}
                          className="h-7 rounded-md bg-rose-600 px-2 text-[11px] font-semibold text-white">
                          {t('common.confirm')}
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(null)}
                          className="h-7 rounded-md border border-app px-2 text-[11px] text-muted">
                          {t('common.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button type="button" aria-label={t('settings.labels.delete')} title={t('settings.labels.delete')}
                        onClick={() => { setConfirmDelete(l.id); setEditing(null); }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-app bg-surface text-muted hover:text-rose-600 dark:hover:text-rose-400">
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Crear etiqueta — compacto, al final */}
      <div className="border-t border-app pt-3">
        <p className="text-[12px] font-medium mb-1.5">{t('settings.labels.name')}</p>
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <input id="nl-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.labels.namePlaceholder')} className={`${inputCls} flex-1 min-w-[160px]`} />
          <div className="flex items-center gap-1.5">
            <ColorSwatches value={color} onChange={setColor} ariaLabel={t('settings.labels.color')} />
          </div>
          <button type="submit" disabled={busy || !name.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60 shrink-0">
            <Tag className="w-3.5 h-3.5" aria-hidden="true" />
            {busy ? t('settings.labels.creating') : t('settings.labels.create')}
          </button>
        </form>
        {error && <p role="alert" className="text-[12px] font-medium text-rose-600 dark:text-rose-400 mt-1.5">{error}</p>}
      </div>
    </Card>
  );
}

/* ---------------- Acerca de ---------------- */
const REPO_URL = 'https://github.com/gnacho/deltos';
const LICENSE = 'AGPL-3.0';

function formatUptime(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function AboutCard({ installState, install }: { installState?: string; install?: () => void }) {
  const { t } = useTranslation();
  const [serverInfo, setServerInfo] = useState<{ version: string; node: string; uptime: number } | null>(null);

  useEffect(() => {
    apiFetch<{ version: string; node: string; uptime: number }>('/api/version')
      .then((res) => setServerInfo(res))
      .catch(() => setServerInfo(null));
  }, []);

  const tiles: { icon: typeof Github; label: string; href?: string }[] = [
    { icon: Github, label: t('settings.about.code'), href: REPO_URL },
    { icon: FileText, label: t('settings.about.changelog'), href: 'https://deltos.cloudless.club/' },
    { icon: Heart, label: t('settings.about.kofi') },
    { icon: ShieldCheck, label: t('settings.about.privacy'), href: 'https://cloudless.club/' },
  ];
  const tileCls =
    'flex items-center gap-2 rounded-lg border border-app px-2.5 py-1 text-[12px] font-medium text-muted transition-colors duration-150 hover:border-brand/50 hover:text-brand';

  const releaseLine = `v${pkg.version} · ${LICENSE}`;
  const runtimeLine = `Node ${serverInfo?.node ?? '—'} · React v${React.version} · ${
    t('settings.about.uptime')
  } ${serverInfo ? formatUptime(serverInfo.uptime) : '—'}`;

  return (
    <Card>
      <Heading icon={Info}>{t('settings.about.title')}</Heading>
      <div className="space-y-5">
        {/* Fila 1: logo + nombre + descripción a la izquierda, enlaces a la derecha */}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex items-start gap-3.5">
            <LogoMark size={40} />
            <div className="min-w-0 flex-1">
              <p className="font-display font-bold text-[16px] leading-tight">{t('common.appName')}</p>
              <p className="text-[13px] text-faint leading-relaxed mt-1.5">{t('settings.about.desc')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {tiles.map((item) =>
              item.href ? (
                <a key={item.label} href={item.href} target="_blank" rel="noreferrer" className={tileCls}>
                  <item.icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="leading-snug">{item.label}</span>
                </a>
              ) : (
                <div key={item.label} className={tileCls}>
                  <item.icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="leading-snug">{item.label}</span>
                </div>
              ),
            )}
          </div>
        </div>
        {/* Fila 2: versión, licencia y runtime en una misma línea sin recuadros,
            alineada con la descripción (tras el logo) en escritorio */}
        <p className="md:pl-[54px] text-[11px] text-faint tnum">{releaseLine} · {runtimeLine}</p>
        {install && installState !== 'hidden' && (
          <div className="md:pl-[54px] mt-2">
            <button
              type="button"
              onClick={install}
              className="inline-flex items-center gap-2 rounded-lg border border-app bg-surface px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface2 hover:text-text"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              {t('settings.install.title')}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------------- Página ---------------- */
export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, demo } = useSession();
  const { state: installState, install } = useInstallPrompt();
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

      {/* Layout canónico: app → perfil → admin → acerca de */}
      <div className="flex flex-col gap-4 md:gap-5">
        <AppearanceCard />
        <LabelsCard />
        <MiPerfilCard />
        {isAdmin && <AdminBar />}
        <AboutCard installState={installState} install={install} />
      </div>
    </div>
  );
}
