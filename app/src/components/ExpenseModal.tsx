import { useEffect, useMemo, useState } from 'react';
import { X, ChevronDown, Plus } from 'lucide-react';
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
  const [projectOpen, setProjectOpen] = useState(false);

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
  const pill = (active: boolean) =>
    `px-3 h-9 rounded-full text-[13px] font-medium border transition-colors ${
      active
        ? 'bg-brand text-brandfg border-brand'
        : 'bg-surface text-muted border-app hover:text-text'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-form-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-xl bg-surface rounded-t-2xl sm:rounded-2xl border border-app shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="shrink-0 z-10 bg-surface/95 backdrop-blur border-b border-app px-5 py-4 flex items-center gap-3">
          <h2 id="expense-form-title" className="font-display font-bold text-[18px] tracking-tight flex-1">
            {isEdit ? t('expenses.form.editTitle') : t('expenses.form.createTitle')}
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

        <div className="flex-1 overflow-y-auto nice-scroll px-5 py-5 space-y-5">
          {/* Título */}
          <div>
            <label className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5" htmlFor="exp-title">
              {t('expenses.form.title')}
            </label>
            <input
              id="exp-title"
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand"
              placeholder={t('expenses.form.titlePlaceholder')}
            />
          </div>

          {/* Importe + fecha */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5" htmlFor="exp-amount">
                {t('expenses.amount')}
              </label>
              <input
                id="exp-amount"
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand tnum"
                placeholder="0,00"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5" htmlFor="exp-date">
                {t('expenses.form.date')}
              </label>
              <input
                id="exp-date"
                type="date"
                value={spentAt}
                onChange={(e) => setSpentAt(e.target.value)}
                className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand tnum"
              />
            </div>
          </div>

          {/* Proyecto (opcional) + categoría */}
          <div className="grid grid-cols-2 gap-4">
            {projects.length > 0 && (
              <div>
                <span className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.form.project')}</span>
                <div className="relative">
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={projectOpen}
                    onClick={() => setProjectOpen((o) => !o)}
                    className="w-full inline-flex items-center gap-2 bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[14px] font-medium outline-none focus:border-brand"
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${projectId ? colorOf(data.getProject(projectId)?.color ?? 'slate').dot : 'bg-faint/40'}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 text-left">{projectId ? data.getProject(projectId)?.name ?? t('expenses.form.noProject') : t('expenses.form.noProject')}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-faint transition-transform duration-200 ${projectOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  {projectOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setProjectOpen(false)} aria-hidden="true" />
                      <ul
                        role="listbox"
                        aria-label={t('expenses.form.project')}
                        className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto nice-scroll rounded-xl bg-surface border border-app shadow-2xl py-1"
                      >
                        <li role="option" aria-selected={projectId === null}>
                          <button
                            type="button"
                            onClick={() => { setProjectId(null); setProjectOpen(false); }}
                            className={`w-full flex items-center gap-2 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${!projectId ? 'font-medium text-brand' : ''}`}
                          >
                            <span className="w-2 h-2 rounded-full shrink-0 bg-faint/20" aria-hidden="true" />
                            <span className="flex-1">{t('expenses.form.noProject')}</span>
                            {!projectId && <span className="text-[12px] font-semibold">{t('task.current')}</span>}
                          </button>
                        </li>
                        {projects.map((p) => {
                          const active = p.id === projectId;
                          return (
                            <li key={p.id} role="option" aria-selected={active}>
                              <button
                                type="button"
                                onClick={() => { setProjectId(p.id); setProjectOpen(false); }}
                                className={`w-full flex items-center gap-2 px-3.5 py-2 text-[14px] text-left hover:bg-surface2 ${active ? 'font-medium text-brand' : ''}`}
                              >
                                <span className={`w-2 h-2 rounded-full shrink-0 ${colorOf(p.color).dot}`} aria-hidden="true" />
                                <span className="flex-1">{p.name}</span>
                                {active && <span className="text-[12px] font-semibold">{t('task.current')}</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className={projects.length === 0 ? 'col-span-2' : ''}>
              <span className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.category')}</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setLabelId(null)} className={pill(labelId === null)}>
                  {t('expenses.form.noCategory')}
                </button>
                {labels.map((l) => (
                  <button key={l.id} type="button" onClick={() => setLabelId(l.id)} className={pill(labelId === l.id)}>
                    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${colorOf(l.color).dot}`} aria-hidden="true" />
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Pagador */}
          <div>
            <span className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.form.payer')}</span>
            <div className="flex flex-wrap gap-1.5">
              {users.map((u) => (
                <button key={u.id} type="button" onClick={() => setPayerId(u.id)} className={pill(payerId === u.id)}>
                  {u.username}
                </button>
              ))}
            </div>
          </div>

          {/* Participantes y reparto */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="block text-[12px] font-semibold tracking-wide uppercase text-faint">{t('expenses.form.participants')}</span>
              <div className="flex items-center gap-2">
                {participants.length > 1 && (
                  <button type="button" onClick={() => setCustomSplit((v) => !v)} className="text-[12px] font-medium text-brand hover:underline">
                    {customSplit ? t('expenses.form.splitEqual') : t('expenses.form.splitCustom')}
                  </button>
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { const el = document.getElementById('modal-add-participant-dropdown'); if (el) el.classList.toggle('hidden'); }}
                    className="w-6 h-6 rounded-lg text-faint hover:bg-surface2 hover:text-brand flex items-center justify-center"
                    aria-label={t('expenses.addParticipant')}
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <div id="modal-add-participant-dropdown" className="hidden absolute right-0 top-full mt-1 z-30 rounded-xl bg-surface border border-app shadow-2xl py-1 min-w-[160px]">
                    {users.filter((u) => !shareStr.has(u.id)).length === 0 ? (
                      <p className="px-3 py-2 text-[13px] text-muted">{t('expenses.allUsersAdded')}</p>
                    ) : (
                      users.filter((u) => !shareStr.has(u.id)).map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => { toggleParticipant(u.id); const el = document.getElementById('modal-add-participant-dropdown'); if (el) el.classList.add('hidden'); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-surface2"
                        >
                          <Avatar name={u.username} color={u.color} size="sm" />
                          <span>{u.username}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
            {participants.length === 0 ? (
              <p className="text-sm text-muted">{t('expenses.noShares')}</p>
            ) : (
              <ul className="rounded-xl border border-app divide-y divide-app overflow-hidden">
                {users.filter((u) => shareStr.has(u.id)).map((u) => (
                  <li key={u.id} className="flex items-center gap-2.5 px-3 py-2 bg-surface2/50">
                    <Avatar name={u.username} color={u.color} />
                    <span className="text-sm flex-1 min-w-0 truncate">{u.username}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={shareStr.get(u.id) ?? ''}
                      onChange={(e) => { setCustomSplit(true); setShareStr((prev) => new Map(prev).set(u.id, e.target.value)); }}
                      className="tnum w-20 rounded-lg bg-surface border border-app px-2 py-1 text-right text-[13px] outline-none focus:border-brand disabled:opacity-70"
                      aria-label={t('expenses.form.shareOf', { name: u.username })}
                    />
                    <button
                      type="button"
                      onClick={() => toggleParticipant(u.id)}
                      className="w-5 h-5 rounded text-faint hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center justify-center shrink-0"
                      aria-label="Quitar"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {participants.length > 0 && !sumOk && amountCents !== null && (
              <p className="mt-1 text-[12px] text-rose-600 dark:text-rose-400">
                {t('expenses.form.sharesSumHint', { sum: fmtMoney(sharesSum, i18n.language), total: fmtMoney(amountCents, i18n.language) })}
              </p>
            )}
          </div>

          {/* Método + etapa */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.form.method')}</span>
              <div className="flex flex-wrap gap-1.5">
                {METHODS.map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(method === m ? null : m)} className={pill(method === m)}>
                    {t(`expenses.${m}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.form.step')}</span>
              <div className="flex flex-wrap gap-1.5">
                {STEPS.map((st) => (
                  <button key={st} type="button" onClick={() => setStep(st)} className={pill(step === st)}>
                    {t(`expenseSteps.${st}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="block text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5" htmlFor="exp-notes">
              {t('expenses.notes')}
            </label>
            <textarea
              id="exp-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-surface2 border border-app rounded-xl px-3.5 py-2.5 text-[15px] font-medium outline-none focus:border-brand resize-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-app space-y-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="w-full h-12 rounded-xl bg-brand text-brandfg text-[15px] font-semibold hover:brightness-110 disabled:opacity-60 shadow-soft"
          >
            {saving
              ? isEdit
                ? t('expenses.form.saving')
                : t('expenses.form.creating')
              : isEdit
                ? t('common.save')
                : t('expenses.form.create')}
          </button>
          <div className="flex items-center justify-between">
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
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-surface2 hover:text-text transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
