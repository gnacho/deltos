import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import type { Expense, ExpenseSplitType, ExpenseStep, PaymentMethod } from '@/data/types';
import { colorOf } from '@/lib/colors';
import { fmtMoney } from '@/lib/format';

interface CreateProps {
  mode: 'create';
  defaultStep?: ExpenseStep;
  onClose: () => void;
  onCreated: (expense: Expense) => void;
}

interface EditProps {
  mode: 'edit';
  expense: Expense;
  onClose: () => void;
  onUpdated: () => void;
}

type Props = CreateProps | EditProps;

const STEPS: ExpenseStep[] = ['nuevo', 'en-curso', 'hecho'];

export function ExpenseModal(props: Props) {
  const { t, i18n } = useTranslation();
  const data = useData();
  const { user } = useSession();
  const modalRef = useRef<HTMLDivElement>(null);

  const isEdit = props.mode === 'edit';
  const expense = isEdit ? props.expense : null;

  const [title, setTitle] = useState(expense?.title ?? '');
  const [amountText, setAmountText] = useState(
    expense ? (expense.amount_cents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [labelId, setLabelId] = useState<string | null>(expense?.label_id ?? null);
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [paidByCreator, setPaidByCreator] = useState(expense?.paid_by_creator ?? false);
  const [requestedUserId, setRequestedUserId] = useState<string | null>(
    expense?.requested_user_id ?? null,
  );
  const [splitType, setSplitType] = useState<ExpenseSplitType | null>(expense?.split_type ?? null);
  const [splitAmountText, setSplitAmountText] = useState(
    expense?.split_amount_cents
      ? (expense.split_amount_cents / 100).toFixed(2).replace('.', ',')
      : '',
  );
  const [step, setStep] = useState<ExpenseStep>(
    expense?.step ?? (props.mode === 'create' ? (props.defaultStep ?? 'nuevo') : 'nuevo'),
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(
    expense?.payment_method ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    const timer = deleteArmed ? window.setTimeout(() => setDeleteArmed(false), 4000) : undefined;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [deleteArmed]);

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

  const labels = data.getLabels();
  const users = data.getUsers().filter((u) => u.id !== user?.id);

  const isCreator = !isEdit || expense?.created_by === user?.id;

  const parseAmount = (): number | null => {
    const cleaned = amountText.replace(',', '.').replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num) || num <= 0) return null;
    return Math.round(num * 100);
  };

  const parseSplitAmount = (): number | null => {
    const cleaned = splitAmountText.replace(',', '.').replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num) || num <= 0) return null;
    return Math.round(num * 100);
  };

  const handleSubmit = async () => {
    setError(null);
    const amountCents = parseAmount();
    if (!amountCents) {
      setError(t('expenses.form.amountRequired'));
      return;
    }
    if (!title.trim()) {
      setError(t('newTask.titleRequired'));
      return;
    }
    if (requestedUserId && !splitType) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    if (splitType === 'custom') {
      const splitCents = parseSplitAmount();
      if (!splitCents) {
        setError(t('expenses.form.amountRequired'));
        return;
      }
    }

    setSaving(true);
    try {
      if (props.mode === 'edit' && expense) {
        await data.updateExpense(expense.id, {
          title: title.trim(),
          amount_cents: amountCents,
          label_id: labelId,
          notes,
          paid_by_creator: paidByCreator,
          requested_user_id: requestedUserId,
          split_type: splitType,
          split_amount_cents: splitType === 'custom' ? parseSplitAmount() : null,
          paid_by_requested: expense.paid_by_requested,
          payment_method: paymentMethod,
          step,
        });
        props.onUpdated();
      } else if (props.mode === 'create') {
        const exp = await data.createExpense({
          title: title.trim(),
          amount_cents: amountCents,
          label_id: labelId,
          notes,
          paid_by_creator: paidByCreator,
          requested_user_id: requestedUserId,
          split_type: splitType,
          split_amount_cents: splitType === 'custom' ? parseSplitAmount() : null,
          payment_method: paymentMethod,
          step,
        });
        props.onCreated(exp);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    if (props.mode !== 'edit' || !props.expense) return;
    setSaving(true);
    try {
      await data.deleteExpense(props.expense.id);
      props.onUpdated();
    } catch {
      setError(t('projects.deleteError'));
    } finally {
      setSaving(false);
    }
  };

  const handlePayMyPart = async () => {
    if (props.mode !== 'edit' || !props.expense || props.expense.paid_by_requested) return;
    try {
      await data.updateExpense(props.expense.id, { paid_by_requested: true });
      props.onUpdated();
    } catch {
      setError(t('projects.deleteError'));
    }
  };

  const isRequested = expense?.requested_user_id === user?.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-form-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={props.onClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        className="relative w-full max-w-lg bg-surface rounded-2xl shadow-xl border border-app overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-app">
          <h2 id="expense-form-title" className="font-display font-bold text-base tracking-tight">
            {isEdit ? t('expenses.form.editTitle') : t('expenses.form.createTitle')}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="p-1 rounded-lg text-muted hover:bg-surface2 hover:text-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3.5 space-y-3 max-h-[70vh] overflow-y-auto nice-scroll">
          {/* Título */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('expenses.form.titleLabel')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('expenses.form.titlePlaceholder')}
              className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text placeholder:text-faint focus:outline-none focus:border-brand"
              autoFocus
            />
          </div>

          {/* Importe */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('expenses.amount')}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder={t('expenses.form.amountPlaceholder')}
              className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text placeholder:text-faint focus:outline-none focus:border-brand"
            />
          </div>

          {/* Categoría (label) */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('expenses.category')}
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setLabelId(null)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  !labelId ? 'bg-brand/15 text-brand' : 'text-muted hover:bg-surface2'
                }`}
              >
                {t('common.none')}
              </button>
              {labels.map((l) => {
                const c = colorOf(l.color);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLabelId(l.id)}
                    className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
                    style={
                      labelId === l.id ? { backgroundColor: c.chip + '30', color: c.chip } : {}
                    }
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('expenses.notes')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('expenses.form.notesPlaceholder')}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text placeholder:text-faint focus:outline-none focus:border-brand resize-none"
            />
          </div>

          {/* Yo ya he pagado */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={paidByCreator}
              onChange={(e) => setPaidByCreator(e.target.checked)}
              className="w-4 h-4 rounded border-border-strong text-brand focus:ring-brand"
            />
            <span className="text-sm text-muted">{t('expenses.iPaid')}</span>
          </label>

          {/* Método de pago */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('expenses.paymentMethod')}
            </label>
            <div className="flex gap-1.5">
              {(['bizum', 'transfer', 'efectivo'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(paymentMethod === m ? null : m)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    paymentMethod === m
                      ? 'bg-brand/15 text-brand'
                      : 'text-muted hover:bg-surface2 hover:text-text border border-app'
                  }`}
                >
                  {t(`expenses.${m}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Requerir pago */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('expenses.requestPayment')}
            </label>
            <select
              value={requestedUserId ?? ''}
              onChange={(e) => {
                const val = e.target.value || null;
                setRequestedUserId(val);
                if (!val) setSplitType(null);
                else if (!splitType) setSplitType('full');
              }}
              className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text focus:outline-none focus:border-brand"
            >
              <option value="">{t('expenses.noRequest')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </div>

          {/* Split */}
          {requestedUserId && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {t('expenses.split')}
              </label>
              <div className="flex gap-1.5">
                {(['half', 'custom', 'full'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSplitType(s)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      splitType === s
                        ? 'bg-brand/15 text-brand'
                        : 'text-muted hover:bg-surface2 hover:text-text border border-app'
                    }`}
                  >
                    {t(`expenses.split${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                  </button>
                ))}
              </div>
              {splitType === 'custom' && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t('expenses.splitAmount')}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={splitAmountText}
                    onChange={(e) => setSplitAmountText(e.target.value)}
                    placeholder={t('expenses.form.amountPlaceholder')}
                    className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text placeholder:text-faint focus:outline-none focus:border-brand"
                  />
                </div>
              )}
            </div>
          )}

          {/* Columna (step) */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('newTask.column')}
            </label>
            <div className="flex gap-1.5">
              {STEPS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStep(s)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    step === s
                      ? 'bg-brand/15 text-brand'
                      : 'text-muted hover:bg-surface2 hover:text-text border border-app'
                  }`}
                >
                  {t(`expenseSteps.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Sección del usuario requerido */}
          {isEdit && isRequested && expense && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {expense.created_by_username} {t('expenses.requestPayment')}:{' '}
                {fmtMoney(splitCents(expense), i18n.language)}
              </p>
              {expense.paid_by_requested ? (
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                  {t('expenses.payMyPartDone')}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handlePayMyPart}
                  className="mt-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                >
                  {t('expenses.payMyPart')}
                </button>
              )}
            </div>
          )}

          {/* They paid badge */}
          {isEdit &&
            expense &&
            expense.requested_user_id &&
            expense.paid_by_requested &&
            !isRequested && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800">
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  {t('expenses.theyPaid', { name: expense.requested_username })}
                </p>
              </div>
            )}

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
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
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                    : 'text-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20'
                }`}
              >
                {deleteArmed ? t('expenses.form.deleteConfirm') : t('expenses.form.delete')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={props.onClose}
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

function splitCents(expense: Expense): number {
  if (expense.split_type === 'half') return Math.round(expense.amount_cents / 2);
  if (expense.split_type === 'custom' && expense.split_amount_cents)
    return expense.split_amount_cents;
  return expense.amount_cents;
}
