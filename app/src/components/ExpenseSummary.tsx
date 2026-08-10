import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import type { Expense } from '@/data/types';
import { useSession } from '@/auth/session-context';
import { colorOf } from '@/lib/colors';
import { useData } from '@/data/data-context';
import { announce } from '@/lib/announce';
import { fmtMoney } from '@/lib/format';

/** Deuda pendiente de un gasto: lo que el requerido aún debe al creador. */
function pendingDebt(e: Expense): number {
  if (!e.requested_user_id || e.paid_by_requested) return 0;
  if (e.split_type === 'half') return Math.round(e.amount_cents / 2);
  if (e.split_type === 'custom') return e.split_amount_cents ?? 0;
  return e.amount_cents; // full
}

/** Saldos netos por pareja (deudor → acreedor) a partir de los gastos abiertos. */
export function useBalances(expenses: Expense[]) {
  return useMemo(() => {
    const net = new Map<
      string,
      { from: string; fromName: string; to: string; toName: string; cents: number }
    >();
    for (const e of expenses) {
      const debt = pendingDebt(e);
      if (!debt || !e.requested_user_id) continue;
      const key = [e.requested_user_id, e.created_by].sort().join('|');
      const prev = net.get(key);
      if (!prev) {
        net.set(key, {
          from: e.requested_user_id,
          fromName: e.requested_username ?? '',
          to: e.created_by,
          toName: e.created_by_username,
          cents: debt,
        });
      } else if (prev.from === e.requested_user_id) {
        prev.cents += debt;
      } else {
        prev.cents -= debt; // deuda en sentido contrario: compensa
        if (prev.cents < 0) {
          net.set(key, {
            from: prev.to,
            fromName: prev.toName,
            to: prev.from,
            toName: prev.fromName,
            cents: -prev.cents,
          });
        }
      }
    }
    return [...net.values()].filter((b) => b.cents > 0).sort((a, b) => b.cents - a.cents);
  }, [expenses]);
}

/** Franja compacta de saldos para la cabecera del tablero. */
export function BalanceStrip({ expenses }: { expenses: Expense[] }) {
  const { t, i18n } = useTranslation();
  const { user: me } = useSession();
  const data = useData();
  const balances = useBalances(expenses);
  const [armed, setArmed] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (balances.length === 0) return null;

  const settle = async (otherId: string) => {
    setSettling(true);
    try {
      const n = await data.settleExpenses(otherId);
      announce(t('expenses.settleDone', { count: n }));
    } catch {
      announce(t('common.error'));
    } finally {
      setSettling(false);
      setArmed(null);
    }
  };

  return (
    <div className="mb-5 flex flex-wrap gap-2" aria-label={t('expenses.balances')}>
      {balances.map((b) => {
        const mine = b.from === me.id || b.to === me.id;
        const otherId = b.from === me.id ? b.to : b.from;
        const key = `${b.from}|${b.to}`;
        const text =
          b.to === me.id
            ? t('expenses.balanceOwesYou', {
                name: b.fromName,
                amount: fmtMoney(b.cents, i18n.language),
              })
            : b.from === me.id
              ? t('expenses.balanceYouOwe', {
                  name: b.toName,
                  amount: fmtMoney(b.cents, i18n.language),
                })
              : t('expenses.balancePair', {
                  from: b.fromName,
                  to: b.toName,
                  amount: fmtMoney(b.cents, i18n.language),
                });
        return (
          <span
            key={key}
            className={`tnum inline-flex items-center gap-2 rounded-full border pl-3 h-9 text-[13px] font-medium ${
              mine
                ? 'border-brand/50 bg-brand/10 text-brand pr-1'
                : 'border-app bg-surface text-muted pr-3'
            }`}
          >
            {text}
            {mine && (
              <button
                type="button"
                disabled={settling}
                onClick={() => (armed === key ? void settle(otherId) : setArmed(key))}
                className={`rounded-full px-2.5 h-7 text-[12px] font-semibold transition-colors disabled:opacity-60 ${
                  armed === key
                    ? 'bg-brand text-brandfg'
                    : 'bg-surface text-muted hover:text-text border border-app'
                }`}
              >
                {armed === key ? t('expenses.settleConfirm') : t('expenses.settle')}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d.getTime());
}

function monthLabel(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** Vista Resumen: total y desglose por categoría del mes + serie de 6 meses. */
export function ExpenseSummary({ expenses }: { expenses: Expense[] }) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => monthKey(Date.now()));

  const ofMonth = useMemo(
    () => expenses.filter((e) => monthKey(e.created_at) === month),
    [expenses, month],
  );
  const total = ofMonth.reduce((s, e) => s + e.amount_cents, 0);

  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; color: string; cents: number }>();
    for (const e of ofMonth) {
      const id = e.label_id ?? 'none';
      const cur = map.get(id) ?? {
        name: e.label_id ? (e.label_name ?? '') : t('expenses.noCategory'),
        color: e.label_color ?? 'slate',
        cents: 0,
      };
      cur.cents += e.amount_cents;
      map.set(id, cur);
    }
    return [...map.values()].sort((a, b) => b.cents - a.cents);
  }, [ofMonth, t]);

  const series = useMemo(() => {
    const out: { key: string; cents: number }[] = [];
    for (let i = 5; i >= 0; i--) out.push({ key: shiftMonth(month, -i), cents: 0 });
    const idx = new Map(out.map((o, i) => [o.key, i]));
    for (const e of expenses) {
      const i = idx.get(monthKey(e.created_at));
      if (i !== undefined) out[i].cents += e.amount_cents;
    }
    return out;
  }, [expenses, month]);

  const maxCat = byCategory[0]?.cents ?? 1;
  const maxMonth = Math.max(...series.map((s) => s.cents), 1);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Selector de mes + total */}
      <div className="rounded-2xl bg-surface border border-app shadow-soft p-5">
        <div className="flex items-center justify-between mb-1">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label={monthLabel(shiftMonth(month, -1), i18n.language)}
            className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center"
          >
            <ChevronLeft className="w-4.5 h-4.5" aria-hidden="true" />
          </button>
          <p className="text-sm font-medium capitalize">{monthLabel(month, i18n.language)}</p>
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label={monthLabel(shiftMonth(month, 1), i18n.language)}
            className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center"
          >
            <ChevronRight className="w-4.5 h-4.5" aria-hidden="true" />
          </button>
        </div>
        <p className="text-[12px] font-semibold tracking-wide uppercase text-faint text-center">
          {t('expenses.monthTotal')}
        </p>
        <p className="tnum font-display font-bold text-3xl text-center mt-1">
          {fmtMoney(total, i18n.language)}
        </p>
      </div>

      {/* Barras por categoría (colores de las labels) */}
      {byCategory.length > 0 && (
        <div className="rounded-2xl bg-surface border border-app shadow-soft p-5">
          <h2 className="font-display font-semibold text-sm mb-4">{t('expenses.byCategory')}</h2>
          <ul className="space-y-3">
            {byCategory.map((c) => (
              <li key={c.name}>
                <div className="flex items-center justify-between text-[13px] mb-1">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${colorOf(c.color).dot}`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="tnum text-muted shrink-0">
                    {fmtMoney(c.cents, i18n.language)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${colorOf(c.color).dot}`}
                    style={{ width: `${Math.max((c.cents / maxCat) * 100, 2)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Serie de 6 meses */}
      <div className="rounded-2xl bg-surface border border-app shadow-soft p-5">
        <h2 className="font-display font-semibold text-sm mb-4">{t('expenses.last6Months')}</h2>
        <div
          className="flex items-end justify-between gap-2 h-32"
          role="img"
          aria-label={t('expenses.last6Months')}
        >
          {series.map((s) => (
            <div key={s.key} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <span className="tnum text-[11px] text-faint">
                {s.cents > 0 ? fmtMoney(s.cents, i18n.language) : ''}
              </span>
              <div
                className={`w-full max-w-10 rounded-t-lg ${s.key === month ? 'bg-brand' : 'bg-surface2'}`}
                style={{ height: `${Math.max((s.cents / maxMonth) * 88, s.cents > 0 ? 6 : 2)}px` }}
              />
              <span className="text-[11px] text-muted capitalize truncate w-full text-center">
                {new Date(
                  Number(s.key.slice(0, 4)),
                  Number(s.key.slice(5)) - 1,
                  1,
                ).toLocaleDateString(i18n.language, { month: 'short' })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Saldos con flecha deudor → acreedor */}
      <div className="rounded-2xl bg-surface border border-app shadow-soft p-5">
        <h2 className="font-display font-semibold text-sm mb-4">{t('expenses.balances')}</h2>
        <Balances expenses={expenses} />
      </div>
    </div>
  );
}

function Balances({ expenses }: { expenses: Expense[] }) {
  const { t, i18n } = useTranslation();
  const balances = useBalances(expenses);
  if (balances.length === 0) {
    return <p className="text-sm text-muted">{t('expenses.settledUp')}</p>;
  }
  return (
    <ul className="space-y-2.5">
      {balances.map((b) => (
        <li key={`${b.from}|${b.to}`} className="flex items-center gap-2 text-[14px]">
          <span className="font-medium">{b.fromName}</span>
          <ArrowRight className="w-3.5 h-3.5 text-faint" aria-hidden="true" />
          <span className="font-medium">{b.toName}</span>
          <span className="tnum ml-auto font-semibold">{fmtMoney(b.cents, i18n.language)}</span>
        </li>
      ))}
    </ul>
  );
}
