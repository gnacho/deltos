import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Check, Circle, DownloadCloud, Loader2, X } from 'lucide-react';
import { ApiError, apiFetch, apiPost } from '@/data/api-client';

/**
 * UpdateDialog (#189): asistente de actualización con changelog y progreso,
 * patrón NetPulse adaptado a la arquitectura deltos (apply asíncrono: flag →
 * systemd .path → root service). El progreso llega de
 * GET /api/update/progress, que lee el JSON que deltos-update.sh escribe en
 * cada STEP. La recarga llega cuando el build del server cambia (versionSig)
 * o el proceso nuevo responde con uptime menor (baseline pre-apply).
 */
type Phase = 'confirm' | 'progress' | 'restarting' | 'error';
type ErrorKind = 'auth' | 'generic' | 'timeout' | 'failed' | 'network';
type ProgressInfo = { step: string; pct: number } | null;
type StatusInfo = { current: string; latest: string | null; available: boolean; notes?: string };

/** Pasos visibles (extract+deploy se agrupan en "install"). */
const VISIBLE_STEPS = ['detect', 'download', 'verify', 'install', 'restart'] as const;
const STEP_ALIAS: Record<string, string> = { extract: 'install', deploy: 'install', done: 'restart' };

const versionSig = () =>
  fetch('/api/version', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j ? `${j.version}+${j.build}` : ''))
    .catch(() => '');

export default function UpdateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('confirm');
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [step, setStep] = useState('detect');
  const [pct, setPct] = useState(0);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);

  const pollRef = useRef<number | null>(null);
  const sigRef = useRef<number | null>(null);
  const baselineRef = useRef('');
  const failRef = useRef(0);
  const phaseRef = useRef<Phase>('confirm');

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const clearTimers = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (sigRef.current !== null) {
      window.clearInterval(sigRef.current);
      sigRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Recargar cuando el server responde con un build distinto al baseline
  // (o un uptime menor: proceso recién reiniciado). Tope 90 s.
  const waitAndReload = useCallback(() => {
    if (phaseRef.current === 'restarting') return;
    setPhaseBoth('restarting');
    const deadline = Date.now() + 90000;
    const id = window.setInterval(async () => {
      const sig = await versionSig();
      if ((sig && baselineRef.current && sig !== baselineRef.current) || Date.now() > deadline) {
        window.clearInterval(id);
        sigRef.current = null;
        if (sig && sig !== baselineRef.current) location.reload();
        else {
          setPhaseBoth('error');
          setErrorKind('timeout');
        }
      }
    }, 2000);
    sigRef.current = id;
  }, []);

  // Reacción al progreso que llega del polling.
  const handleProgress = useCallback(
    (p: ProgressInfo) => {
      failRef.current = 0;
      if (!p) {
        // Sin fichero fresco aún (el .path tarda en disparar): seguir esperando.
        return;
      }
      if (p.step === 'error') {
        clearTimers();
        setPhaseBoth('error');
        setErrorKind('failed');
        return;
      }
      setStep(p.step);
      setPct(Math.min(100, Math.max(0, p.pct)));
      if (p.step === 'done' || p.pct >= 100) {
        clearTimers();
        waitAndReload();
      }
    },
    [clearTimers, waitAndReload],
  );

  const startPolling = useCallback(() => {
    if (pollRef.current !== null) return;
    const poll = async () => {
      try {
        const j = await apiFetch<{ progress: ProgressInfo }>('/api/update/progress');
        handleProgress(j?.progress ?? null);
      } catch {
        // El server cae durante el reinicio: tras 2 fallos, esperar recarga.
        failRef.current += 1;
        if (failRef.current >= 2 && phaseRef.current === 'progress') {
          clearTimers();
          waitAndReload();
        }
      }
    };
    void poll();
    pollRef.current = window.setInterval(poll, 1500);
  }, [clearTimers, handleProgress, waitAndReload]);

  const apply = async () => {
    try {
      baselineRef.current = await versionSig();
    } catch {
      baselineRef.current = '';
    }
    try {
      await apiPost('/api/update/apply', undefined, { noAuthEvent: true });
      setPhaseBoth('progress');
      startPolling();
    } catch (e) {
      setPhaseBoth('error');
      if (e instanceof ApiError && e.status === 401) setErrorKind('auth');
      else setErrorKind('generic');
    }
  };

  // Al abrir: estado fresco; al cerrar: cortar timers.
  useEffect(() => {
    if (open) {
      setPhaseBoth('confirm');
      setStep('detect');
      setPct(0);
      setErrorKind(null);
      failRef.current = 0;
      void apiFetch<StatusInfo>('/api/update/status')
        .then((s) => setStatus(s))
        .catch(() => undefined);
    } else {
      clearTimers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visibleStep = STEP_ALIAS[step] ?? step;
  const activeIdx = VISIBLE_STEPS.indexOf(visibleStep as (typeof VISIBLE_STEPS)[number]);
  const busy = phase === 'progress' || phase === 'restarting';

  const changelogLines = (status?.notes ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(co-authored-by|signed-off-by|reviewed-by):/i.test(l))
    .map((l) => l.replace(/^[-*]\s+/, ''));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('update.dialog.title')}
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <DownloadCloud className="h-5 w-5 text-sky-500" aria-hidden />
            {t('update.dialog.title')}
          </h2>
          {!busy && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('update.dialog.cancel')}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {phase === 'confirm' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
              <span className="font-mono text-sm text-slate-500 dark:text-slate-400">
                {status?.current || '…'}
              </span>
              <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
              <span className="font-mono text-sm font-bold text-sky-600 dark:text-sky-400">
                {status?.latest || '…'}
              </span>
            </div>
            <p className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">
              {t('update.dialog.desc')}
            </p>
            {changelogLines.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {t('update.dialog.changelogTitle')}
                </p>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
                  <ul className="flex flex-col gap-1">
                    {changelogLines.map((l, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-[12px] leading-snug text-slate-600 dark:text-slate-300"
                      >
                        <span
                          className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400"
                          aria-hidden
                        />
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {t('update.dialog.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-sky-700"
              >
                <DownloadCloud className="h-4 w-4" aria-hidden />
                {t('update.dialog.start')}
              </button>
            </div>
          </div>
        )}

        {phase === 'progress' && (
          <div className="flex flex-col gap-4" role="status">
            <ul className="flex flex-col gap-2.5">
              {VISIBLE_STEPS.map((s, i) => {
                const done = activeIdx > i || step === 'done';
                const active = activeIdx === i && step !== 'done';
                return (
                  <li key={s} className="flex items-center gap-2.5 text-sm">
                    {done ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2} aria-hidden />
                    ) : active ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-sky-500"
                        strokeWidth={2}
                        aria-hidden
                      />
                    ) : (
                      <Circle
                        className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600"
                        strokeWidth={2}
                        aria-hidden
                      />
                    )}
                    <span
                      className={
                        done
                          ? 'text-slate-500 dark:text-slate-400'
                          : active
                            ? 'font-medium text-slate-900 dark:text-white'
                            : 'text-slate-400 dark:text-slate-500'
                      }
                    >
                      {t(`update.step.${s}`)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-1.5">
              <div
                className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                role="progressbar"
                aria-label={t('update.dialog.progressLabel')}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{t(`update.step.${visibleStep}`)}…</span>
                <span className="font-mono">{pct}%</span>
              </div>
            </div>
          </div>
        )}

        {phase === 'restarting' && (
          <div className="flex flex-col items-center gap-3 py-4" role="status">
            <Loader2 className="h-10 w-10 animate-spin text-sky-500" strokeWidth={1.5} aria-hidden />
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {t('update.dialog.restarting')}
            </p>
            <p className="text-xs text-slate-400">{t('update.dialog.reloadSoon')}</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 px-4 py-3 dark:bg-red-950/40">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  {t('update.dialog.failed')}
                </p>
                <p className="mt-1 text-[12px] leading-snug text-red-600/80 dark:text-red-400/80">
                  {errorKind === 'auth'
                    ? t('update.applyErrorAuth')
                    : errorKind === 'timeout'
                      ? t('update.applyTimeout')
                      : errorKind === 'failed'
                        ? t('update.dialog.failedStep')
                        : t('update.applyError')}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {errorKind !== 'auth' && (
                <button
                  type="button"
                  onClick={() => void apply()}
                  className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {t('update.dialog.retry')}
                </button>
              )}
              <button
                type="button"
                onClick={() => (errorKind === 'auth' ? location.reload() : onClose())}
                className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-sky-700"
              >
                {errorKind === 'auth' ? t('update.reload') : t('update.dialog.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
