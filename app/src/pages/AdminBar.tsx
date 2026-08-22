import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  HardDrive,
  Home,
  KeyRound,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useSession } from '@/auth/session-context';
import { apiFetch, apiPost, apiPut, apiDelete } from '@/data/api-client';
import { apiErrorText } from '@/lib/errors';
import { Avatar } from '@/components/Avatar';
import { CheckToggle } from '@/components/CheckToggle';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { setUpdateBanner } from '@/hooks/update-banner-store';
import pkg from '../../package.json';

const REPO_URL = 'https://github.com/gnacho/deltos';

interface AdminUser {
  id: string;
  username: string;
  language: string;
  role: 'user' | 'admin';
  color?: string | null;
}

interface ServerSettings {
  backup_enabled: boolean;
  backup_retention_days: number;
  max_attachments_per_task: number;
  backup_last_run: string | null;
  backup_path: string | null;
  backup_timer_active: boolean;
  plugin_expenses_enabled: boolean;
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={`settings-card rounded-2xl bg-surface border border-app shadow-soft p-5 ${className ?? ''}`}>
      {children}
    </section>
  );
}

function fmtDate(iso: string | null, locale: string) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

/* ---------- 1. Comprobar actualizaciones (1 vez por semana) ---------- */
function UpdateCheck({ upd }: { upd: ReturnType<typeof useAppUpdate> }) {
  const { t } = useTranslation();

  useEffect(() => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const last = localStorage.getItem('deltos-last-update-check');
    const lastTime = last ? Number(last) : 0;
    if (!lastTime || Date.now() - lastTime > week) {
      void upd.check().then(() => {
        localStorage.setItem('deltos-last-update-check', Date.now().toString());
      });
    }
  }, [upd]);

  if (!upd.supported) return null;

  return (
    <div className="flex flex-col gap-1">
      {upd.swWaiting ? (
        <button
          type="button"
          aria-label={t('settings.about.updateNow')}
          onClick={upd.applySw}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold text-brandfg transition-colors hover:brightness-110"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('settings.about.updateNow')}</span>
        </button>
      ) : (
        <button
          type="button"
          aria-label={t('settings.about.checkUpdates')}
          onClick={() => void upd.check()}
          disabled={upd.state === 'checking'}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-app bg-surface2 px-3 text-[13px] font-medium text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-60"
        >
          <RefreshCw
            className={`w-4 h-4 ${upd.state === 'checking' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">
            {upd.state === 'checking' ? t('settings.about.checking') : t('settings.about.checkUpdates')}
          </span>
        </button>
      )}
      {upd.state === 'up-to-date' && (
        <span className="text-[10px] font-medium text-ok">
          {t('settings.admin.update.upToDateShort')}
        </span>
      )}
      {upd.state === 'available' && upd.latest && (
        <a
          href={upd.latest.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-medium text-ok"
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          {t('settings.about.updateAvailable', { version: upd.latest.version })}
        </a>
      )}
      {upd.state === 'error' && (
        <span role="alert" className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
          {t('settings.about.updateError')}
        </span>
      )}
    </div>
  );
}

/* ---------- 2. Modo demo (check estilo Helios) ---------- */
function DemoToggle() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ demo_enabled: boolean }>('/api/settings/demo')
      .then((res) => { if (!cancelled) setEnabled(res.demo_enabled); })
      .catch(() => { if (!cancelled) setError(t('settings.demoError')); });
    return () => { cancelled = true; };
  }, [t]);

  const toggle = async () => {
    if (enabled === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPut<{ demo_enabled: boolean }>('/api/settings/demo', { enabled: !enabled });
      setEnabled(res.demo_enabled);
    } catch (err) {
      setError(apiErrorText(err, t('settings.demoError')));
    } finally {
      setBusy(false);
    }
  };

  if (enabled === null) {
    return (
      <div className="h-9 w-20 animate-pulse rounded-xl border border-app bg-surface2" aria-busy="true" />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <CheckToggle
        checked={enabled}
        onChange={() => void toggle()}
        label={t('settings.demoMode')}
        icon={Sparkles}
        disabled={busy}
        variant="switch"
      />
      {error && <span role="alert" className="text-[12px] text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  );
}

/* ---------- 3. Panel de respaldos ---------- */
function BackupsPanel({ expanded }: { expanded: boolean }) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    apiFetch<ServerSettings>('/api/settings/server')
      .then((res) => { if (!cancelled) setSettings(res); })
      .catch(() => { if (!cancelled) setError(t('settings.server.saveError')); });
    return () => { cancelled = true; };
  }, [expanded, t]);

  const save = async (patch: Partial<ServerSettings>) => {
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiPut<ServerSettings>('/api/settings/server', {
        backup_enabled: patch.backup_enabled ?? settings.backup_enabled,
        backup_retention_days: patch.backup_retention_days ?? settings.backup_retention_days,
        max_attachments_per_task: patch.max_attachments_per_task ?? settings.max_attachments_per_task,
        plugin_expenses_enabled: patch.plugin_expenses_enabled ?? settings.plugin_expenses_enabled,
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

  const doExport = () => {
    window.open('/api/export', '_blank');
  };

  if (!expanded || !settings) return null;

  const locale = i18n.language === 'auto' ? navigator.language : i18n.language;

  return (
    <div className="w-full mt-4 pt-4 border-t border-app">
      <div className="flex flex-wrap items-start gap-4">
        <CheckToggle
          checked={settings.backup_enabled}
          onChange={() => void save({ backup_enabled: !settings.backup_enabled })}
          label={t('settings.admin.backup.title')}
          icon={Database}
          disabled={busy}
          size="sm"
          variant="switch"
        />

        <button
          type="button"
          onClick={() => void runBackup()}
          disabled={backupBusy}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-50"
        >
          <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
          {backupBusy ? t('settings.server.backupRunning') : t('settings.admin.backup.backupNow')}
        </button>

        <button
          type="button"
          onClick={doExport}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-app bg-surface2 px-3 text-[12px] font-medium text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {t('settings.admin.backup.export')}
        </button>

        <div className="flex flex-col gap-0.5 text-[11px] text-faint">
          <span>
            {t('settings.admin.backup.lastRun', { date: fmtDate(settings.backup_last_run, locale) })}
          </span>
          <span>
            {t('settings.admin.backup.nextRun', {
              when: settings.backup_timer_active
                ? t('settings.admin.backup.tomorrow')
                : t('settings.admin.backup.notScheduled'),
            })}
          </span>
        </div>
      </div>

      {(error || success) && (
        <div className="mt-3">
          {error && <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">{error}</p>}
          {success && <p role="status" className="text-[13px] font-medium text-ok">{success}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- 4. Usuarios (despliega listado + crear) ---------- */
function UsersPanel() {
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

  const selectCls = 'h-9 rounded-lg border border-app bg-surface px-2 text-[13px] text-text outline-none focus:border-brand';
  const iconBtnCls = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-app bg-surface2 text-muted hover:text-text transition-colors';

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">{error}</p>}

      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="rounded-xl border border-app bg-surface2 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Avatar name={u.username} color={u.color ?? null} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-tight truncate">
                  {u.username}
                  {u.id === me.id && (
                    <span className="ml-1.5 text-[12px] font-normal text-faint">({t('settings.users.you')})</span>
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
                    onClick={() => { setPwdFor(pwdFor === u.id ? null : u.id); setNewPwd(''); }}
                  >
                    <KeyRound className="w-4 h-4" aria-hidden="true" />
                  </button>
                  {confirmDelete === u.id ? (
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void remove(u.id)}
                        className="h-9 rounded-lg bg-rose-600 px-3 text-[13px] font-semibold text-white"
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="h-9 rounded-lg border border-app px-3 text-[13px] text-muted"
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
                onSubmit={(e) => { e.preventDefault(); void resetPassword(u.id); }}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder={t('settings.users.newPassword')}
                  className="h-10 flex-1 rounded-lg border border-app bg-surface px-3 text-[14px] outline-none focus:border-brand"
                />
                <button
                  type="submit"
                  disabled={newPwd.length < 6}
                  className="h-10 rounded-lg bg-brand px-4 text-[13px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60"
                >
                  {t('common.save')}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {!showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-app bg-surface2 px-4 text-[14px] font-semibold hover:bg-surface transition-colors"
        >
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          {t('settings.users.create')}
        </button>
      ) : (
        <form onSubmit={create} className="space-y-3 border-t border-app pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('settings.users.username')}
              className="h-10 rounded-lg border border-app bg-surface px-3 text-[14px] outline-none focus:border-brand"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('settings.users.password')}
              className="h-10 rounded-lg border border-app bg-surface px-3 text-[14px] outline-none focus:border-brand"
            />
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={selectCls}>
              <option value="auto">🌐 Auto</option>
              <option value="es">🇪🇸 Español</option>
              <option value="en">🇬🇧 English</option>
            </select>
            <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} className={selectCls}>
              <option value="user">{t('settings.users.roleUser')}</option>
              <option value="admin">{t('settings.users.roleAdmin')}</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              {busy ? t('settings.users.creating') : t('settings.users.create')}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setError(null); }}
              className="h-10 rounded-lg border border-app px-4 text-[14px] text-muted hover:bg-surface2 transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ---------- Home Assistant ---------- */
function HaPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{ enabled: boolean; username: string | null } | null>(null);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const s = await apiFetch<{ enabled: boolean; username: string | null }>('/api/ha/status');
      setStatus(s);
      setUsername(s.username ?? '');
      setError(null);
    } catch (err) {
      setError(apiErrorText(err, t('settings.ha.error')));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setToken(null);
    try {
      const res = await apiPost<{ token: string; username: string | null }>('/api/ha/token', {
        username: username.trim() || undefined,
      });
      setToken(res.token);
      setStatus({ enabled: true, username: res.username });
    } catch (err) {
      setError(apiErrorText(err, t('settings.ha.error')));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete('/api/ha/token');
      setStatus({ enabled: false, username: null });
      setToken(null);
    } catch (err) {
      setError(apiErrorText(err, t('settings.ha.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ha-username" className="text-[13px] text-muted">
          {t('settings.ha.usernameLabel')}
        </label>
        <input
          id="ha-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="nacho"
          className="bg-surface2 border border-app rounded-lg px-3 py-2 text-[14px] outline-none focus:border-brand w-40"
        />
        {status?.enabled ? (
          <button
            type="button"
            onClick={() => void revoke()}
            disabled={busy}
            className="h-9 rounded-lg border border-rose-300 px-3 text-[13px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:text-rose-300 dark:border-rose-500/40 dark:hover:bg-rose-500/10"
          >
            {t('settings.ha.revoke')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            className="h-9 rounded-lg bg-brand px-3 text-[13px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-60"
          >
            {busy ? t('settings.ha.generating') : t('settings.ha.generate')}
          </button>
        )}
      </div>

      {status?.enabled && !token && (
        <p className="text-[13px] text-ok">{t('settings.ha.enabled')}</p>
      )}

      {token && (
        <div className="rounded-xl border border-app bg-surface2 p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint mb-1">
            {t('settings.ha.tokenLabel')}
          </p>
          <code className="block break-all text-[13px] font-mono select-all">{token}</code>
          <p className="text-[12px] text-faint mt-1.5">{t('settings.ha.tokenHint')}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- Barra de administración ---------- */
export default function AdminBar() {
  const { t } = useTranslation();
  const { user } = useSession();
  const upd = useAppUpdate(pkg.version, REPO_URL);
  const [showBackups, setShowBackups] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [showHa, setShowHa] = useState(false);

  /* Publica el resultado del check en el store para que el ribbon global lo
     muestre: release nueva → ribbon; al día / error → sin ribbon. */
  useEffect(() => {
    if (upd.state === 'available' && upd.latest) {
      setUpdateBanner({
        available: true,
        version: upd.latest.version,
        url: upd.latest.url,
        swWaiting: !!upd.swWaiting,
        applySw: upd.swWaiting ? upd.applySw : null,
        applyRelease: upd.applyRelease,
        dismissVersion: upd.dismissVersion,
      });
    } else if (upd.state === 'idle' || upd.state === 'checking') {
      // el check sigue en curso: no tocar el ribbon hasta saber el resultado
    } else {
      setUpdateBanner({
        available: false,
        version: null,
        url: null,
        swWaiting: !!upd.swWaiting,
        applySw: upd.swWaiting ? upd.applySw : null,
        applyRelease: null,
      });
    }
  }, [upd.state, upd.latest, upd.swWaiting, upd.applyRelease]);

  if (user.role !== 'admin') return null;

  const activeBtnCls = 'border-brand bg-brand/10 text-brand';
  const inactiveBtnCls = 'border-app bg-surface2 text-muted hover:bg-surface hover:text-text';

  return (
    <Card className="border-l-4 border-l-brand bg-brand/[0.05]">
      {/* Fila horizontal */}
      <div className="flex flex-wrap items-start gap-3 sm:gap-4 min-w-0">
        <div className="flex items-center gap-2 shrink-0 h-9">
          <Shield className="w-5 h-5 text-brand" aria-hidden="true" />
          <h2 className="font-display font-semibold text-[15px]">{t('settings.admin.title')}</h2>
        </div>

        <div className="hidden sm:block h-6 w-px bg-app" />

        <UpdateCheck upd={upd} />

        <button
          type="button"
          aria-label={t('settings.admin.backup.button')}
          aria-expanded={showBackups}
          onClick={() => setShowBackups((v) => !v)}
          className={[
            'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors shrink-0',
            showBackups ? activeBtnCls : inactiveBtnCls,
          ].join(' ')}
        >
          <Database className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{t('settings.admin.backup.button')}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${showBackups ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          aria-label={t('settings.users.title')}
          aria-expanded={showUsers}
          onClick={() => setShowUsers((v) => !v)}
          className={[
            'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors shrink-0',
            showUsers ? activeBtnCls : inactiveBtnCls,
          ].join(' ')}
        >
          <Users className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('settings.users.title')}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${showUsers ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          aria-label={t('settings.ha.title')}
          aria-expanded={showHa}
          onClick={() => setShowHa((v) => !v)}
          className={[
            'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors shrink-0',
            showHa ? activeBtnCls : inactiveBtnCls,
          ].join(' ')}
        >
          <Home className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{t('settings.ha.title')}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${showHa ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        <div className="ml-auto">
          <DemoToggle />
        </div>
      </div>

      {/* Paneles desplegados */}
      <BackupsPanel expanded={showBackups} />
      {showHa && (
        <div className="mt-4 border-t border-app pt-4">
          <HaPanel />
        </div>
      )}
      {showUsers && (
        <div className="mt-4 border-t border-app pt-4">
          <UsersPanel />
        </div>
      )}
    </Card>
  );
}
