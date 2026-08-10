import { useEffect, useMemo, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import type { Expense, ExpenseStep, PaymentMethod } from '@/data/types';
import { Avatar } from '@/components/Avatar';
import { colorOf } from '@/lib/colors';
import { fmtMoney } from '@/lib/format';
import { apiErrorText } from '@/lib/errors';

const METHODS: PaymentMethod[] = ['bizum', 'transfer', 'efectivo'];
const STEPS: ExpenseStep[] = ['nuevo', 'en-curso', 'hecho'];

type Props =
  { mode: 'create'; onClose: () => void } | { mode: 'edit'; expense: Expense; onClose: () => void };

function toCents(v: string): number | null {
  const n = Number.parseFloat(v.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function dateInputValue(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Reparto equitativo con céntimos sobrantes a los primeros. */
function equalSplit(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

export function ExpenseModal(props: Props) {
  const { t, i18n } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const isEdit = props.mode === 'edit';
  const expense = isEdit ? props.expense : null;
  const users = data.getUsers();
  const projects = data.getProjects();
  const labels = data.getLabels();

  const [title, setTitle] = useState(expense?.title ?? '');
  const [amountStr, setAmountStr] = useState(expense ? fromCents(expense.amount_cents) : '');
  const [labelId, setLabelId] = useState<string | null>(expense?.label_id ?? null);
  const [projectId, setProjectId] = useState<string | null>(expense?.project_id ?? null);
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [payerId, setPayerId] = useState(expense?.payer_id ?? me.id);
  const [spentAt, setSpentAt] = useState(dateInputValue(expense?.spent_at ?? Date.now()));
  const [method, setMethod] = useState<PaymentMethod | null>(expense?.payment_method ?? null);
  const [step, setStep] = useState<ExpenseStep>(expense?.step ?? 'nuevo');
  /** Partes: userId → céntimos (texto editable por persona). */
  const [shareStr, setShareStr] = useState<Map<string, string>>(
    () => new Map((expense?.shares ?? []).map((sh) => [sh.user_id, fromCents(sh.share_cents)])),
  );
  const [customSplit, setCustomSplit] = useState(() => {
    const shares = expense?.shares ?? [];
    if (shares.length < 2) return false;
    const eq = equalSplit(expense?.amount_cents ?? 0, shares.length);
    return !shares.every(
      (sh, i) =>
        sh.share_cents === eq[i] ||
        sh.share_cents === eq[0] ||
        sh.share_cents === eq[eq.length - 1],
    );
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const amountCents = toCents(amountStr);
  const participants = useMemo(() => [...shareStr.keys()], [shareStr]);

  /* Reparto equitativo en vivo salvo modo importes por persona */
  useEffect(() => {
    if (customSplit || amountCents === null || participants.length === 0) return;
    const eq = equalSplit(amountCents, participants.length);
    setShareStr((prev) => {
      const next = new Map(prev);
      participants.forEach((uid, i) => next.set(uid, fromCents(eq[i])));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountCents, participants.length, customSplit]);

  const onClose = props.onClose;
  useEffect(() => {
    const lastFocus = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (lastFocus instanceof HTMLElement) lastFocus.focus();
    };
  }, [onClose]);

  const toggleParticipant = (uid: string) => {
    setShareStr((prev) => {
      const next = new Map(prev);
      if (next.has(uid)) next.delete(uid);
      else next.set(uid, '0,00');
      return next;
    });
  };

  const sharesSum = participants.reduce(
    (sum, uid) => sum + (toCents(shareStr.get(uid) ?? '') ?? 0),
    0,
  );
  const sumOk = participants.length === 0 || (amountCents !== null && sharesSum === amountCents);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError(t('newTask.titleRequired'));
      return;
    }
    if (amountCents === null || amountCents === 0) {
      setError(t('expenses.form.amountRequired'));
      return;
    }
    if (!sumOk) {
      setError(t('expenses.form.sharesSum'));
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      title: title.trim(),
      amount_cents: amountCents,
      label_id: labelId,
      project_id: projectId,
      notes,
      payer_id: payerId,
      spent_at: Date.parse(`${spentAt}T12:00:00`),
      payment_method: method,
      step,
      shares: participants.map((uid) => ({
        user_id: uid,
        share_cents: toCents(shareStr.get(uid) ?? '') ?? 0,
      })),
    };
    try {
      if (isEdit && expense) await data.updateExpense(expense.id, payload);
      else await data.createExpense(payload);
      onClose();
    } catch (e) {
      setError(apiErrorText(e, t('common.error')));
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    if (!expense) return;
    try {
      await data.deleteExpense(expense.id);
      onClose();
    } catch {
      setError(t('common.error'));
    }
  };

  const isCreator = expense ? expense.created_by === me.id : true;
  const field =
    'w-full rounded-xl bg-surface2 border border-app px-3 py-2 text-sm outline-none focus:border-brand';
  const label = 'block text-xs font-medium text-muted mb-1';
  const pill = (active: boolean) =>
    `px-3 h-9 rounded-full text-[13px] font-medium border transition-colors ${
      active
        ? 'bg-brand text-brandfg border-brand'
        : 'bg-surface text-muted border-app hover:text-text'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-form-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg bg-surface rounded-2xl shadow-xl border border-app overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-app">
          <h2 id="expense-form-title" className="font-display font-bold text-base tracking-tight">
            {isEdit ? t('expenses.form.editTitle') : t('expenses.form.createTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:bg-surface2 hover:text-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3.5 space-y-3 max-h-[72vh] overflow-y-auto nice-scroll">
          {/* Título + importe + fecha */}
          <div>
            <label className={label} htmlFor="exp-title">
              {t('expenses.form.title')}
            </label>
            <input
              id="exp-title"
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={field}
              placeholder={t('expenses.form.titlePlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="exp-amount">
                {t('expenses.amount')}
              </label>
              <input
                id="exp-amount"
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className={`${field} tnum`}
                placeholder="0,00"
              />
            </div>
            <div>
              <label className={label} htmlFor="exp-date">
                {t('expenses.form.date')}
              </label>
              <input
                id="exp-date"
                type="date"
                value={spentAt}
                onChange={(e) => setSpentAt(e.target.value)}
                className={`${field} tnum`}
              />
            </div>
          </div>

          {/* Pagador */}
          <div>
            <span className={label}>{t('expenses.form.payer')}</span>
            <div className="flex flex-wrap gap-1.5">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setPayerId(u.id)}
                  className={pill(payerId === u.id)}
                >
                  {u.username}
                </button>
              ))}
            </div>
          </div>

          {/* Participantes y reparto */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={label}>{t('expenses.form.participants')}</span>
              {participants.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCustomSplit((v) => !v)}
                  className="text-[12px] font-medium text-brand hover:underline"
                >
                  {customSplit ? t('expenses.form.splitEqual') : t('expenses.form.splitCustom')}
                </button>
              )}
            </div>
            <ul className="rounded-xl border border-app divide-y divide-app overflow-hidden">
              {users.map((u) => {
                const on = shareStr.has(u.id);
                return (
                  <li key={u.id} className="flex items-center gap-2.5 px-3 py-2 bg-surface2/50">
                    <button
                      type="button"
                      onClick={() => toggleParticipant(u.id)}
                      aria-pressed={on}
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        on ? 'bg-brand border-brand text-brandfg' : 'border-strong bg-surface'
                      }`}
                    >
                      {on && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                    </button>
                    <Avatar name={u.username} color={u.color} />
                    <span className="text-sm flex-1 min-w-0 truncate">{u.username}</span>
                    {on && (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={shareStr.get(u.id) ?? ''}
                        disabled={!customSplit}
                        onChange={(e) =>
                          setShareStr((prev) => new Map(prev).set(u.id, e.target.value))
                        }
                        className="tnum w-20 rounded-lg bg-surface border border-app px-2 py-1 text-right text-[13px] outline-none focus:border-brand disabled:opacity-70"
                        aria-label={t('expenses.form.shareOf', { name: u.username })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            {participants.length > 0 && !sumOk && amountCents !== null && (
              <p className="mt-1 text-[12px] text-rose-600 dark:text-rose-400">
                {t('expenses.form.sharesSumHint', {
                  sum: fmtMoney(sharesSum, i18n.language),
                  total: fmtMoney(amountCents, i18n.language),
                })}
              </p>
            )}
          </div>

          {/* Proyecto (opcional) + categoría */}
          {projects.length > 0 && (
            <div>
              <span className={label}>{t('expenses.form.project')}</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setProjectId(null)}
                  className={pill(projectId === null)}
                >
                  {t('expenses.form.noProject')}
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProjectId(p.id)}
                    className={pill(projectId === p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <span className={label}>{t('expenses.category')}</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setLabelId(null)}
                className={pill(labelId === null)}
              >
                {t('expenses.form.noCategory')}
              </button>
              {labels.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLabelId(l.id)}
                  className={pill(labelId === l.id)}
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full mr-1.5 ${colorOf(l.color).dot}`}
                    aria-hidden="true"
                  />
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          {/* Método + etapa */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>{t('expenses.form.method')}</span>
              <div className="flex flex-wrap gap-1.5">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(method === m ? null : m)}
                    className={pill(method === m)}
                  >
                    {t(`expenses.${m}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className={label}>{t('expenses.form.step')}</span>
              <div className="flex flex-wrap gap-1.5">
                {STEPS.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStep(st)}
                    className={pill(step === st)}
                  >
                    {t(`expenseSteps.${st}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className={label} htmlFor="exp-notes">
              {t('expenses.notes')}
            </label>
            <textarea
              id="exp-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${field} resize-none`}
            />
          </div>

          {error && (
            <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-app">
          <div>
            {isEdit && isCreator && expense && (
              <button
                type="button"
                onClick={handleDelete}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  deleteArmed
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                    : 'text-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10'
                }`}
              >
                {deleteArmed ? t('expenses.form.deleteConfirm') : t('expenses.form.delete')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-sm text-muted hover:bg-surface2 hover:text-text transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-brand text-brandfg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving
                ? isEdit
                  ? t('expenses.form.saving')
                  : t('expenses.form.creating')
                : isEdit
                  ? t('common.save')
                  : t('expenses.form.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
