import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Check, Paperclip, Clock, Download, ChevronDown, FileText, FileSpreadsheet, FileImage, File as FileIcon } from 'lucide-react';
import { fmtMoney } from '@/lib/format';
import { LogoMark } from '@/components/Logo';
import { relTime } from '@/i18n';

interface Attachment {
  id: string;
  filename: string;
  size: number;
  mime: string;
}

interface ActivityEvent {
  id: string;
  type: string;
  data: string;
  created_at: number;
  username: string;
}

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
    payment_method: string | null;
    notes: string;
  };
  attachments: Attachment[];
  activity: ActivityEvent[];
}

const PAYMENT_METHODS = [
  { value: 'bizum', key: 'expenses.bizum' },
  { value: 'transfer', key: 'expenses.transfer' },
  { value: 'efectivo', key: 'expenses.efectivo' },
] as const;

function iconFor(mime: string, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return { Icon: FileImage, cls: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' };
  }
  if (mime.includes('sheet') || mime.includes('csv') || ['xls', 'xlsx', 'ods', 'csv'].includes(ext)) {
    return { Icon: FileSpreadsheet, cls: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' };
  }
  if (mime === 'application/pdf' || ['pdf', 'doc', 'docx', 'odt', 'txt', 'md'].includes(ext)) {
    return { Icon: FileText, cls: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' };
  }
  return { Icon: FileIcon, cls: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('bizum');
  const [showAttachments, setShowAttachments] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

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
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}/pay`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method: paymentMethod }),
      });
      if (!res.ok) throw res;
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

  const { expense, invite, attachments, activity } = data;
  const shareLabel = `${fmtMoney(invite.share_cents, i18n.language)} de ${fmtMoney(expense.amount_cents, i18n.language)}`;

  return (
    <div className="min-h-screen flex flex-col items-center py-8 px-4 bg-surface">
      <LogoMark size={48} />
      <div className="w-full max-w-sm mt-4 space-y-4">
        {/* Tarjeta principal */}
        <div className="rounded-2xl border border-app bg-surface2 p-6 shadow-soft">
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
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2.5">
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    {t('invite.alreadyPaid')}
                  </span>
                </div>
                {invite.payment_method && (
                  <p className="text-[13px] text-muted">
                    {t('expenses.paymentMethod')}: {t(`expenses.${invite.payment_method}`)}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {invite.notes && (
                  <p className="text-[13px] text-muted leading-relaxed bg-surface2 rounded-lg px-3 py-2">{invite.notes}</p>
                )}
                <div>
                  <p className="text-[12px] font-medium text-muted mb-1.5">{t('expenses.paymentMethod')}</p>
                  <div className="flex gap-1.5">
                    {PAYMENT_METHODS.map(({ value, key: k }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPaymentMethod(value)}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-medium transition-colors ${
                          paymentMethod === value
                            ? 'border-brand bg-brand/10 text-brand'
                            : 'border-app text-muted hover:bg-surface2'
                        }`}
                      >
                        {t(k)}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={paying}
                  className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-brand text-brandfg text-[15px] font-semibold hover:brightness-110 disabled:opacity-60 shadow-soft"
                >
                  {paying ? t('common.saving') : t('invite.markAsPaid')}
                </button>
              </div>
            )}
          </div>
          {expense.notes && (
            <p className="text-[13px] text-muted mt-3 leading-relaxed bg-surface2 rounded-lg px-3 py-2">{expense.notes}</p>
          )}
          {/* Nota del invitador */}
          {invite.notes && paid && (
            <p className="text-[13px] text-muted mt-3 leading-relaxed">{invite.notes}</p>
          )}
        </div>

        {/* Adjuntos */}
        {attachments && attachments.length > 0 && (
          <div className="rounded-2xl border border-app bg-surface p-5 shadow-soft">
            <button
              type="button"
              onClick={() => setShowAttachments(!showAttachments)}
              className="w-full flex items-center gap-2 text-left"
            >
              <Paperclip className="w-4 h-4 text-faint" aria-hidden="true" />
              <span className="text-sm font-semibold flex-1">{t('task.tabs.adjuntos')} ({attachments.length})</span>
              <ChevronDown className={`w-4 h-4 text-faint transition-transform ${showAttachments ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {showAttachments && (
              <ul className="mt-3 space-y-2">
                {attachments.map((a) => {
                  const { Icon, cls } = iconFor(a.mime, a.filename);
                  return (
                    <li key={a.id} className="flex items-center gap-3 rounded-xl border border-app px-3 py-2.5 bg-surface2/50">
                      <span className={`w-9 h-9 rounded-lg ${cls} flex items-center justify-center shrink-0`}>
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium truncate">{a.filename}</span>
                        <span className="block text-[12px] text-faint">{fmtSize(a.size)}</span>
                      </span>
                      <a
                        href={`/api/expenses/${expense.id}/attachments/${encodeURIComponent(a.id)}`}
                        download={a.filename}
                        className="w-8 h-8 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center shrink-0"
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Actividad */}
        {activity && activity.length > 0 && (
          <div className="rounded-2xl border border-app bg-surface p-5 shadow-soft">
            <button
              type="button"
              onClick={() => setShowActivity(!showActivity)}
              className="w-full flex items-center gap-2 text-left"
            >
              <Clock className="w-4 h-4 text-faint" aria-hidden="true" />
              <span className="text-sm font-semibold flex-1">{t('task.tabs.actividad')}</span>
              <ChevronDown className={`w-4 h-4 text-faint transition-transform ${showActivity ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {showActivity && (
              <ul className="mt-3 space-y-3">
                {activity.map((ev) => (
                  <li key={ev.id} className="flex gap-2.5 text-[13px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-faint/50 mt-1.5 shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-muted leading-relaxed">
                        <strong className="text-text">{ev.username}</strong>{' '}
                        {ev.type}
                        {ev.data && typeof ev.data === 'object' && Object.keys(ev.data).length > 0 && (
                          <span className="text-faint"> {JSON.stringify(ev.data)}</span>
                        )}
                      </p>
                      <p className="text-[12px] text-faint mt-0.5">{relTime(ev.created_at, t)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-[12px] text-faint text-center pt-2">
          Deltos · {t('invite.noAccount')}
        </p>
      </div>
    </div>
  );
}
