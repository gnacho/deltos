import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { getCsrfToken } from '@/data/api-client';
import { announce } from '@/lib/announce';
import { fmtMoney } from '@/lib/format';

interface InviteRow {
  id: string;
  invite_name: string;
  share_cents: number;
  paid: boolean;
  notes?: string;
}

interface Props {
  expenseId: string;
  amountCents: number;
  /** Suma de las partes (shares) declaradas en el gasto, para el aviso de importe. */
  sharesCents?: number;
}

/** Panel de invitaciones externas (enlace compartible) para un gasto.
 *  Reutilizado por el modal de detalle y por el modal de creación tras crear. */
export function ExpenseInvitePanel({ expenseId, amountCents, sharesCents = 0 }: Props) {
  const { t, i18n } = useTranslation();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteCents, setInviteCents] = useState(Math.max(Math.round(amountCents / 2), 1));
  const [inviteNotes, setInviteNotes] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteDone, setInviteDone] = useState(false);
  const [invites, setInvites] = useState<InviteRow[]>([]);

  const loadInvites = () => {
    fetch(`/api/expenses/${expenseId}/invites`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setInvites(d.invites ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseId]);

  const handleInvite = async () => {
    if (!inviteName.trim()) {
      setInviteError(t('invite.nameRequired'));
      return;
    }
    setInviteSending(true);
    setInviteError(null);
    try {
      const csrf = getCsrfToken();
      const res = await fetch('/api/invite/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf ?? '' },
        body: JSON.stringify({
          invite_name: inviteName.trim(),
          share_cents: inviteCents,
          expense_id: expenseId,
          notes: inviteNotes.trim(),
        }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const info = await res.json().catch(() => ({}));
        const msg = (info as any)?.error?.message || `Error ${res.status}`;
        setInviteError(msg);
        return;
      }
      const respData = await res.json();
      await navigator.clipboard.writeText(`${window.location.origin}/invite/${respData.invite.token}`);
      setInviteDone(true);
      announce(t('invite.linkCopied'));
      loadInvites();
    } catch (e: any) {
      setInviteError(e?.message || t('common.error'));
    } finally {
      setInviteSending(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      const csrf = getCsrfToken();
      const res = await fetch(`/api/invite/${inviteId}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrf ?? '' },
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const info = await res.json().catch(() => ({}));
        setInviteError((info as any)?.error?.message || t('common.error'));
        return;
      }
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch {
      announce(t('common.error'));
    }
  };

  const invitesCents = invites.reduce((s, i) => s + i.share_cents, 0);
  const totalCents = sharesCents + invitesCents;
  const overCents = totalCents - amountCents;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] font-semibold tracking-wide uppercase text-faint">
          {t('invite.shareLink')}
        </p>
        <button
          type="button"
          onClick={() => setInviteOpen(!inviteOpen)}
          className="text-[12px] font-medium text-brand hover:underline"
        >
          + {t('invite.shareLink')}
        </button>
      </div>

      {invites.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {invites.map((inv) => (
            <li key={inv.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{inv.invite_name}</span>
              <span className="tnum text-[13px]">{fmtMoney(inv.share_cents, i18n.language)}</span>
              {inv.paid ? (
                <span className="text-[12px] text-emerald-600 dark:text-emerald-400 font-medium">
                  {t('expenses.paid')}
                </span>
              ) : (
                <span className="text-[12px] text-amber-600 dark:text-amber-400 font-medium">
                  {t('expenses.pending')}
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleRevokeInvite(inv.id)}
                className="w-7 h-7 rounded-lg text-muted hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center"
                title={t('invite.revoke')}
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {inviteOpen && !inviteDone && (
        <div className="rounded-xl border border-app bg-surface2/50 p-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder={t('invite.namePlaceholder')}
              className="flex-1 rounded-lg bg-surface border border-app px-3 py-1.5 text-sm outline-none focus:border-brand"
            />
            <input
              type="text"
              inputMode="decimal"
              value={(inviteCents / 100).toFixed(2).replace('.', ',')}
              onChange={(e) => {
                const n = parseFloat(e.target.value.replace(',', '.'));
                if (!isNaN(n) && n >= 0) setInviteCents(Math.round(n * 100));
              }}
              className="w-24 rounded-lg bg-surface border border-app px-3 py-1.5 text-sm text-right outline-none focus:border-brand tnum"
            />
          </div>
          <input
            type="text"
            value={inviteNotes}
            onChange={(e) => setInviteNotes(e.target.value)}
            placeholder={t('invite.notesPlaceholder', { defaultValue: 'Nota (opcional)' })}
            maxLength={500}
            className="w-full rounded-lg bg-surface border border-app px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={() => void handleInvite()}
            disabled={inviteSending || !inviteName.trim()}
            className="w-full h-9 rounded-lg bg-brand text-brandfg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
          >
            {inviteSending ? '...' : t('invite.copyLink')}
          </button>
          {inviteError && (
            <p role="alert" className="text-[12px] font-medium text-rose-600 dark:text-rose-400">
              {inviteError}
            </p>
          )}
        </div>
      )}
      {inviteOpen && inviteDone && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-3 space-y-2">
          <p className="text-[13px] text-emerald-700 dark:text-emerald-300 font-medium">
            {t('invite.linkCopied')}
          </p>
          <button
            type="button"
            onClick={() => {
              setInviteDone(false);
              setInviteName('');
              setInviteNotes('');
            }}
            className="text-[12px] text-brand hover:underline"
          >
            {t('invite.shareLink')}
          </button>
        </div>
      )}

      {/* Aviso de importe: la suma de partes + invitaciones no debe superar el total */}
      {invites.length > 0 && overCents > 0 && (
        <p className="mt-2 rounded-lg px-3 py-2 text-[13px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          {t('expenses.form.sharesSumOver', {
            sum: fmtMoney(totalCents, i18n.language),
            total: fmtMoney(amountCents, i18n.language),
            over: fmtMoney(overCents, i18n.language),
          })}
        </p>
      )}
    </div>
  );
}
