import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, Gift, Plus, Trash2, X } from 'lucide-react';
import {
  createReward,
  deleteReward,
  getRewards,
  redeemReward,
} from '@/data/api-client';
import { GAMIFICATION_EVENT } from '@/data/DataProvider';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { apiErrorText } from '@/lib/errors';
import { Avatar } from '@/components/Avatar';
import { relTime } from '@/i18n';
import type { GamificationSummary, Reward } from '@/data/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type ConfirmAction = { kind: 'redeem' | 'delete'; id: string } | null;

/** Una línea del historial: concesión de puntos o canje, ordenables por fecha. */
type HistoryItem =
  | { kind: 'earned'; at: number; name: string; points: number; title: string }
  | { kind: 'redeemed'; at: number; name: string; cost: number; emoji: string; title: string };

function buildHistory(summary: GamificationSummary | null): HistoryItem[] {
  if (!summary) return [];
  const items: HistoryItem[] = [
    ...summary.recent.map((e) => ({
      kind: 'earned' as const,
      at: e.created_at,
      name: e.display_name ?? e.username,
      points: e.points,
      title: e.task_title ?? '?',
    })),
    ...summary.redemptions.map((r) => ({
      kind: 'redeemed' as const,
      at: r.created_at,
      name: r.display_name ?? r.username,
      cost: r.cost,
      emoji: r.reward_emoji,
      title: r.reward_title,
    })),
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, 12);
}

/**
 * Panel modal de gamificación: karma semanal de los usuarios, recompensas
 * canjeables (crear / canjear / eliminar) e historial reciente. El resumen
 * llega por el DataProvider (SSE gamification.changed); la lista de
 * recompensas se recarga al abrir y ante el evento window GAMIFICATION_EVENT.
 */
export default function RewardsPanel({ open, onClose }: Props) {
  const { t } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('');
  const [cost, setCost] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<Element | null>(null);

  const summary = data.getGamificationSummary();
  const myBalance = summary?.users.find((u) => u.user_id === me.id)?.balance ?? 0;
  const history = buildHistory(summary);

  const loadRewards = useCallback(async () => {
    try {
      const res = await getRewards();
      setRewards(res.rewards);
    } catch {
      /* se reintenta al abrir o con el próximo evento */
    }
  }, []);

  /* Carga inicial + refresco en vivo (evento SSE propagado por DataProvider). */
  useEffect(() => {
    if (!open) return;
    void loadRewards();
    window.addEventListener(GAMIFICATION_EVENT, loadRewards);
    return () => window.removeEventListener(GAMIFICATION_EVENT, loadRewards);
  }, [open, loadRewards]);

  /* Modal accesible: Escape cierra, foco inicial y restauración al cerrar. */
  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    titleRef.current?.focus();
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      const el = lastFocus.current;
      if (el instanceof HTMLElement) el.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setConfirm(null);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const afterMutation = () => {
    setConfirm(null);
    setBusy(false);
    data.refreshGamification();
    void loadRewards();
  };

  const doRedeem = async (reward: Reward) => {
    setBusy(true);
    setError(null);
    try {
      await redeemReward(reward.id);
      afterMutation();
    } catch (err) {
      setError(apiErrorText(err, t('gamification.redeemError')));
      setBusy(false);
      setConfirm(null);
    }
  };

  const doDelete = async (reward: Reward) => {
    setBusy(true);
    setError(null);
    try {
      await deleteReward(reward.id);
      afterMutation();
    } catch (err) {
      setError(apiErrorText(err, t('gamification.deleteRewardError')));
      setBusy(false);
      setConfirm(null);
    }
  };

  const submitReward = async (e: FormEvent) => {
    e.preventDefault();
    const costN = Number(cost);
    if (!title.trim() || !Number.isInteger(costN) || costN < 1) return;
    setBusy(true);
    setError(null);
    try {
      await createReward({
        title: title.trim(),
        ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
        cost: costN,
      });
      setTitle('');
      setEmoji('');
      setCost('');
      setBusy(false);
      data.refreshGamification();
      void loadRewards();
    } catch (err) {
      setError(apiErrorText(err, t('gamification.addRewardError')));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rewards-panel-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-xl bg-surface rounded-t-2xl sm:rounded-2xl border border-app shadow-2xl max-h-[92vh] overflow-y-auto nice-scroll">
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-app px-5 py-4 flex items-center gap-3">
          <h2
            id="rewards-panel-title"
            className="font-display font-bold text-[18px] tracking-tight flex-1"
          >
            {t('gamification.panelTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-6">
          {/* Karma semanal, lado a lado */}
          <section aria-label={t('gamification.weeklyTitle')}>
            <h3 className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-2.5">
              {t('gamification.weeklyTitle')}
            </h3>
            <div className="flex flex-wrap gap-2.5">
              {(summary?.users ?? []).map((u) => (
                <div
                  key={u.user_id}
                  className="flex-1 min-w-[150px] rounded-2xl bg-surface2 border border-app px-3.5 py-3"
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={u.display_name ?? u.username} color={u.color} size="sm" />
                    <span className="text-[14px] font-medium truncate">
                      {u.display_name ?? u.username}
                    </span>
                    {u.streak_days > 0 && (
                      <span
                        className="ml-auto inline-flex items-center gap-0.5 text-[12px] font-semibold text-amber-600 dark:text-amber-400"
                        title={t('gamification.streak', { count: u.streak_days })}
                      >
                        <Flame className="w-3.5 h-3.5" aria-hidden="true" />
                        <span className="tnum">{u.streak_days}</span>
                      </span>
                    )}
                  </div>
                  <p className="tnum mt-2 text-[20px] font-bold leading-none">
                    {u.week_points}
                    <span className="ml-1 text-[12px] font-medium text-faint">
                      {t('gamification.points')}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[12px] text-faint">
                    {t('gamification.balance')}: <span className="tnum font-semibold text-muted">{u.balance}</span>
                    {' · '}
                    {t('gamification.tasksDone', { count: u.tasks_done_total })}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Recompensas canjeables */}
          <section aria-label={t('gamification.rewardsTitle')}>
            <h3 className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-2.5">
              {t('gamification.rewardsTitle')}
            </h3>
            {rewards.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-app px-4 py-4 text-center text-[13px] text-muted">
                {t('gamification.rewardsEmpty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {rewards.map((r) => {
                  const affordable = myBalance >= r.cost;
                  const confirmingRedeem = confirm?.kind === 'redeem' && confirm.id === r.id;
                  const confirmingDelete = confirm?.kind === 'delete' && confirm.id === r.id;
                  return (
                    <li
                      key={r.id}
                      className="rounded-2xl bg-surface2 border border-app px-3.5 py-2.5 flex items-center gap-3"
                    >
                      <span className="text-xl shrink-0" aria-hidden="true">
                        {r.emoji || '🎁'}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-medium truncate">{r.title}</span>
                        <span className="tnum text-[12px] text-faint">
                          {r.cost} {t('gamification.points')}
                        </span>
                      </span>
                      {confirmingRedeem || confirmingDelete ? (
                        <span className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void (confirmingRedeem ? doRedeem(r) : doDelete(r))
                            }
                            className={`h-8 rounded-lg px-2.5 text-[12px] font-semibold text-white disabled:opacity-60 ${
                              confirmingRedeem
                                ? 'bg-brand text-brandfg hover:brightness-110'
                                : 'bg-rose-600 hover:brightness-110'
                            }`}
                          >
                            {t('common.confirm')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirm(null)}
                            className="h-8 rounded-lg px-2.5 text-[12px] font-medium bg-surface border border-app text-muted hover:text-text disabled:opacity-60"
                          >
                            {t('common.cancel')}
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={!affordable || busy}
                            title={
                              affordable
                                ? t('gamification.redeemConfirm', { title: r.title, cost: r.cost })
                                : t('errors.INSUFFICIENT_POINTS')
                            }
                            onClick={() => setConfirm({ kind: 'redeem', id: r.id })}
                            className="h-8 rounded-lg bg-brand px-3 text-[12px] font-semibold text-brandfg hover:brightness-110 disabled:opacity-50"
                          >
                            {t('gamification.redeem')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            title={t('gamification.deleteReward')}
                            aria-label={t('gamification.deleteReward')}
                            onClick={() => setConfirm({ kind: 'delete', id: r.id })}
                            className="w-8 h-8 rounded-lg text-faint hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center justify-center disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Formulario compacto: nueva recompensa */}
            <form onSubmit={submitReward} className="mt-3 flex items-center gap-2">
              <label className="sr-only" htmlFor="rw-emoji">
                {t('gamification.rewardEmojiLabel')}
              </label>
              <input
                id="rw-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🎁"
                maxLength={8}
                className="w-14 h-10 rounded-lg bg-surface2 border border-app px-2 text-center text-[15px] outline-none focus:border-brand"
              />
              <label className="sr-only" htmlFor="rw-title">
                {t('gamification.rewardTitleLabel')}
              </label>
              <input
                id="rw-title"
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('gamification.rewardTitlePlaceholder')}
                maxLength={120}
                required
                className="flex-1 min-w-0 h-10 rounded-lg bg-surface2 border border-app px-3 text-[14px] outline-none focus:border-brand"
              />
              <label className="sr-only" htmlFor="rw-cost">
                {t('gamification.rewardCostLabel')}
              </label>
              <input
                id="rw-cost"
                value={cost}
                onChange={(e) => setCost(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={t('gamification.rewardCostLabel')}
                inputMode="numeric"
                required
                className="tnum w-20 h-10 rounded-lg bg-surface2 border border-app px-2 text-center text-[14px] outline-none focus:border-brand"
              />
              <button
                type="submit"
                disabled={busy || !title.trim() || !cost}
                title={t('gamification.addReward')}
                aria-label={t('gamification.addReward')}
                className="w-10 h-10 shrink-0 rounded-lg bg-brand text-brandfg hover:brightness-110 disabled:opacity-50 flex items-center justify-center"
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
              </button>
            </form>
          </section>

          {error && (
            <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          {/* Historial reciente (concesiones + canjes) */}
          <section aria-label={t('gamification.historyTitle')}>
            <h3 className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-2.5">
              {t('gamification.historyTitle')}
            </h3>
            {history.length === 0 ? (
              <p className="text-[13px] text-faint">{t('gamification.historyEmpty')}</p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((h, i) => (
                  <li
                    key={`${h.kind}-${h.at}-${i}`}
                    className="flex items-baseline gap-2 text-[13px]"
                  >
                    {h.kind === 'earned' ? (
                      <span className="flex-1 min-w-0 truncate">
                        <span className="tnum font-semibold text-emerald-600 dark:text-emerald-400">
                          +{h.points}
                        </span>
                        <span className="text-muted"> · {h.title}</span>
                        <span className="text-faint"> · {h.name}</span>
                      </span>
                    ) : (
                      <span className="flex-1 min-w-0 truncate">
                        <Gift className="inline w-3.5 h-3.5 -mt-0.5 mr-1 text-faint" aria-hidden="true" />
                        <span className="text-muted">
                          {t('gamification.redeemed', {
                            name: h.name,
                            emoji: h.emoji,
                            title: h.title,
                          })}
                        </span>
                        <span className="tnum text-faint"> (−{h.cost})</span>
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] text-faint">{relTime(h.at, t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
