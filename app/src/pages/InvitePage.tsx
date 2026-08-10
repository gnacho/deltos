import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { fmtMoney } from '@/lib/format';
import { LogoMark } from '@/components/Logo';

interface InviteData {
  expense: {
    id: string;
    title: string;
    amount_cents: number;
    payer_id: string;
    notes: string;
  };
  invite: {
    id: string;
    invite_name: string;
    share_cents: number;
    paid: boolean;
  };
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invite/${encodeURIComponent(token)}`)
      .then((r) => { if (!r.ok) throw r; return r.json(); })
      .then((res) => {
        setData(res);
        setPaid(res.invite.paid);
      })
      .catch(() => {
        setError(t('common.error'));
      })
      .finally(() => setLoading(false));
  }, [token, t]);

  const handlePay = async () => {
    if (!token) return;
    setPaying(true);
    try {
      await fetch(`/api/invite/${encodeURIComponent(token)}/pay`, { method: 'PUT' });
      setPaid(true);
    } catch {
      // ignore
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-5 h-5 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-surface px-4">
        <LogoMark size={48} />
        <p className="text-muted text-sm">{error || t('common.error')}</p>
      </div>
    );
  }

  const { expense, invite } = data;
  const shareLabel = `${fmtMoney(invite.share_cents, i18n.language)} de ${fmtMoney(expense.amount_cents, i18n.language)}`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface px-4">
      <LogoMark size={48} />
      <div className="w-full max-w-sm rounded-2xl border border-app bg-surface2 p-6 shadow-soft">
        <p className="text-sm text-muted mb-1">
          {t('invite.hello', { name: invite.invite_name })}
        </p>
        <h1 className="font-display font-bold text-xl tracking-tight mb-4">
          {expense.title}
        </h1>
        <div className="rounded-xl border border-app bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">{t('invite.yourPart')}</span>
            <span className="tnum text-[17px] font-semibold">{shareLabel}</span>
          </div>
          {paid ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2.5">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {t('invite.alreadyPaid')}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handlePay}
              disabled={paying}
              className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-brand text-brandfg text-[15px] font-semibold hover:brightness-110 disabled:opacity-60 shadow-soft"
            >
              {paying ? t('common.saving') : t('invite.markAsPaid')}
            </button>
          )}
        </div>
        {expense.notes && (
          <p className="text-[13px] text-muted mt-3 leading-relaxed">{expense.notes}</p>
        )}
      </div>
      <p className="text-[12px] text-faint">
        Deltos · {t('invite.noAccount')}
      </p>
    </div>
  );
}
