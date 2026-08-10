import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Info, Paperclip, MessageCircle, Clock, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import type { Expense, ExpenseStep } from '@/data/types';
import type { Attachment, ActivityEvent, Comment } from '@/data/types';
import { colorOf } from '@/lib/colors';
import { Avatar } from '@/components/Avatar';
import { relTime } from '@/i18n';
import { apiErrorText } from '@/lib/errors';
import { announce } from '@/lib/announce';
import { fmtSize, fmtMoney } from '@/lib/format';
import { ImageLightbox } from '@/components/task/ImageLightbox';
import { PhotoCropDialog } from '@/components/PhotoCropDialog';
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  File as FileIcon,
  Download,
  Plus,
  Move,
  Flag,
  Calendar,
  User,
  Type,
} from 'lucide-react';

const STEPS: ExpenseStep[] = ['nuevo', 'en-curso', 'hecho'];
const MAX_BYTES = 10 * 1024 * 1024;

type Tab = 'detalles' | 'adjuntos' | 'comentarios' | 'actividad';

const TABS: { id: Tab; icon: typeof Info }[] = [
  { id: 'detalles', icon: Info },
  { id: 'adjuntos', icon: Paperclip },
  { id: 'comentarios', icon: MessageCircle },
  { id: 'actividad', icon: Clock },
];

const EVENT_ICON: Record<string, typeof Plus> = {
  created: Plus,
  title: Type,
  amount: FileIcon,
  category: Flag,
  notes: FileText,
  paid: Calendar,
  requested: User,
  split: Move,
  payment_method: Type,
  moved: Move,
  attachment: Paperclip,
};

function isImageAttachment(a: Attachment) {
  const ext = a.filename.split('.').pop()?.toLowerCase() ?? '';
  return a.mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
}

function iconFor(mime: string, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return {
      Icon: FileImage,
      cls: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    };
  }
  if (
    mime.includes('sheet') ||
    mime.includes('csv') ||
    ['xls', 'xlsx', 'ods', 'csv'].includes(ext)
  ) {
    return {
      Icon: FileSpreadsheet,
      cls: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    };
  }
  if (mime === 'application/pdf' || ['pdf', 'doc', 'docx', 'odt', 'txt', 'md'].includes(ext)) {
    return {
      Icon: FileText,
      cls: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    };
  }
  return { Icon: FileIcon, cls: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' };
}

interface Props {
  expense: Expense;
  onClose: () => void;
  onDeleted: () => void;
}

export function ExpenseDetailModal({ expense: initialExpense, onClose, onDeleted }: Props) {
  const { t, i18n } = useTranslation();
  const data = useData();
  const { user } = useSession();
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>('detalles');
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const lastFocus = useRef<Element | null>(null);

  const detail = data.getExpenseDetail(initialExpense.id);
  const expense = detail?.expense ?? initialExpense;

  useEffect(() => {
    lastFocus.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    void data.refreshExpenseDetail(expense.id);
    return () => {
      document.body.style.overflow = '';
      data.releaseExpenseDetail(expense.id);
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expense.id]);

  useEffect(() => {
    const t = deleteArmed ? window.setTimeout(() => setDeleteArmed(false), 4000) : undefined;
    return () => {
      if (t) clearTimeout(t);
    };
  }, [deleteArmed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const labels = data.getLabels();
  const isCreator = expense.created_by === user?.id;

  const patch = async (p: Record<string, unknown>) => {
    await data.updateExpense(expense.id, p);
  };

  // --- Comments ---
  const [commentBody, setCommentBody] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const handleAddComment = async (e: FormEvent) => {
    e.preventDefault();
    const text = commentBody.trim();
    if (!text || commentSending) return;
    setCommentSending(true);
    setCommentError(null);
    try {
      await data.addExpenseComment(expense.id, text);
      setCommentBody('');
    } catch (err) {
      setCommentError(apiErrorText(err, t('comments.error')));
    } finally {
      setCommentSending(false);
    }
  };

  // --- Attachments ---
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    if (file.size > MAX_BYTES) {
      setUploadError(t('attachments.tooBig'));
      return;
    }
    if (file.type.startsWith('image/')) {
      setCropFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    doUpload(file);
  };

  const doUpload = async (file: File) => {
    setUploading(true);
    try {
      await data.uploadExpenseAttachment(expense.id, file);
    } catch (err) {
      setUploadError(apiErrorText(err, t('attachments.uploadError')));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCropSave = async (blob: Blob) => {
    setUploadError(null);
    setUploading(true);
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    try {
      await data.uploadExpenseAttachment(
        expense.id,
        new File([blob], `photo.${ext}`, { type: blob.type }),
      );
    } catch (err) {
      setUploadError(apiErrorText(err, t('attachments.uploadError')));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAttachment = async (attId: string) => {
    await data.deleteExpenseAttachment(expense.id, attId);
  };

  const handleDeleteExpense = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      await data.deleteExpense(expense.id);
      onDeleted();
    } catch {
      announce(t('common.error'));
    }
  };

  const handleMove = (step: ExpenseStep) => {
    data.moveExpense(expense.id, step, 0);
  };
  const handlePayMyPart = () => {
    void data.setMyShare(expense.id, true).catch(() => announce(t('common.error')));
  };

  const attachments: Attachment[] = detail?.attachments ?? [];
  const comments: Comment[] = detail?.comments ?? [];
  const activity: ActivityEvent[] = detail?.activity ?? [];

  const images = attachments.filter(isImageAttachment).map((a) => ({
    src: `/api/expenses/${expense.id}/attachments/${encodeURIComponent(a.id)}`,
    alt: a.filename,
  }));

  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"][data-tab]');
    if (!el) return;
    e.preventDefault();
    const tabs = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"][data-tab]'),
    );
    const i = tabs.indexOf(el);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.dataset.tab as Tab);
    next.focus();
  };

  const openViewer = (a: Attachment) => {
    const i = images.findIndex((img) => img.src.endsWith(encodeURIComponent(a.id)));
    if (i >= 0) setViewer(i);
  };

  const tabCount = (id: Tab): number => {
    if (id === 'adjuntos') return attachments.length;
    if (id === 'comentarios') return comments.length;
    return 0;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch lg:items-center lg:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="relative w-full h-full lg:h-auto lg:max-h-[88vh] lg:max-w-2xl bg-surface lg:rounded-2xl border border-app shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Cabecera fija: título + tab bar (mismo patrón que TaskModal) */}
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-app">
          <div className="px-5 lg:px-7 pt-4 pb-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2
                id="expense-modal-title"
                className="font-display font-bold text-[20px] lg:text-[22px] tracking-tight leading-snug"
              >
                {expense.title}
              </h2>
              <p className="tnum text-sm text-muted mt-0.5">
                {fmtMoney(expense.amount_cents, i18n.language)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center shrink-0"
              aria-label={t('task.closeDetail')}
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <div
            role="tablist"
            aria-label={t('task.tabs.label')}
            className="flex px-1 lg:px-4 overflow-x-auto no-scrollbar"
            onKeyDown={onTabKeyDown}
          >
            {TABS.map(({ id, icon: Icon }) => {
              const active = tab === id;
              const n = tabCount(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  data-tab={id}
                  aria-selected={active}
                  aria-controls={`panel-${id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(id)}
                  className={`relative flex items-center gap-1 lg:gap-1.5 px-2 lg:px-3 py-2.5 -mb-px border-b-2 text-[12px] lg:text-[13px] font-medium whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-brand text-brand'
                      : 'border-transparent text-muted hover:text-[var(--text)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 lg:w-4 lg:h-4" aria-hidden="true" />
                  <span>{t(`task.tabs.${id}`)}</span>
                  {n > 0 && (
                    <span className="tnum px-1 lg:px-1.5 py-px rounded-full text-[12px] bg-surface2 text-muted">
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto nice-scroll">
        <div className="px-5 lg:px-7 py-5 pb-8">
          {/* --- DETALLES --- */}
          {tab === 'detalles' && (
            <div className="space-y-3.5 max-w-2xl">
              {/* Título + Importe */}
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1">
                    {t('expenses.form.titleLabel')}
                  </p>
                  <input
                    type="text"
                    key={`title-${expense.id}-${expense.updated_at}`}
                    defaultValue={expense.title}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== expense.title) patch({ title: v });
                      else e.target.value = expense.title;
                    }}
                    className="w-full bg-transparent text-[16px] font-medium outline-none border-b border-transparent focus:border-brand pb-0.5"
                  />
                </div>
                <div className="shrink-0">
                  <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1">
                    {t('expenses.amount')}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      defaultValue={(expense.amount_cents / 100).toFixed(2).replace('.', ',')}
                      onBlur={(e) => {
                        const n = parseFloat(e.target.value.replace(',', '.'));
                        if (!isNaN(n) && n > 0) patch({ amount_cents: Math.round(n * 100) });
                      }}
                      className="w-28 px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text focus:outline-none focus:border-brand"
                    />
                    <span className="text-sm text-muted">EUR</span>
                  </div>
                </div>
              </div>

              {/* Etapa + Categoría */}
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1">
                    {t('expenses.etapa')}
                  </p>
                  <div className="flex gap-1.5">
                    {STEPS.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleMove(s)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          expense.step === s
                            ? 'bg-brand/15 text-brand'
                            : 'text-muted hover:bg-surface2 border border-app'
                        }`}
                      >
                        {t(`expenseSteps.${s}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1">
                    {t('expenses.category')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => patch({ label_id: null })}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${!expense.label_id ? 'bg-brand/15 text-brand' : 'text-muted hover:bg-surface2'}`}
                    >
                      {t('common.none')}
                    </button>
                    {labels.map((l) => {
                      const c = colorOf(l.color);
                      return (
                        <button
                          key={l.id}
                          onClick={() => patch({ label_id: l.id })}
                          className="px-2 py-0.5 rounded text-xs font-medium"
                          style={
                            expense.label_id === l.id
                              ? { backgroundColor: c.chip + '30', color: c.chip }
                              : {}
                          }
                        >
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Notas */}
              <div>
                <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1">
                  {t('expenses.notes')}
                </p>
                <textarea
                  defaultValue={expense.notes}
                  onBlur={(e) => {
                    if (e.target.value !== expense.notes) patch({ notes: e.target.value });
                  }}
                  rows={2}
                  placeholder={t('expenses.form.notesPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text focus:outline-none focus:border-brand resize-none"
                />
              </div>

              {/* Reparto: partes por participante */}
              <div>
                <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1">
                  {t('expenses.form.participants')}
                </p>
                {!expense.shares?.length ? (
                  <p className="text-sm text-muted">{t('expenses.noShares')}</p>
                ) : (
                  <ul className="rounded-xl border border-app divide-y divide-app overflow-hidden">
                    {expense.shares.map((sh) => (
                      <li
                        key={sh.user_id}
                        className="flex items-center gap-2.5 px-3 py-2 bg-surface2/50"
                      >
                        <Avatar name={sh.username} color={sh.user_color} />
                        <span className="text-sm flex-1 min-w-0 truncate">
                          {sh.username}
                          {sh.user_id === expense.payer_id && (
                            <span className="ml-1.5 text-[11px] text-faint">
                              ({t('expenses.payerTag')})
                            </span>
                          )}
                        </span>
                        <span className="tnum text-[13px] font-semibold">
                          {fmtMoney(sh.share_cents, i18n.language)}
                        </span>
                        {sh.paid ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            {t('expenses.paid')}
                          </span>
                        ) : sh.user_id === user?.id ? (
                          <button
                            type="button"
                            onClick={handlePayMyPart}
                            className="px-2.5 py-1 rounded-lg text-[12px] font-medium bg-brand text-brandfg hover:brightness-110"
                          >
                            {t('expenses.payMyPart')}
                          </button>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            {t('expenses.pending')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-[12px] text-faint">
                  {t('expenses.paidBy', { name: expense.payer_username })} ·{' '}
                  {new Date(expense.spent_at).toLocaleDateString(i18n.language)}
                  {expense.project_name ? ` · ${expense.project_name}` : ''}
                </p>
              </div>

              {/* Delete */}
              {isCreator && (
                <div className="pt-4 border-t border-app flex justify-end">
                  <button
                    type="button"
                    onClick={handleDeleteExpense}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium ${
                      deleteArmed
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 hover:bg-rose-200/70 dark:hover:bg-rose-500/25'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    {deleteArmed ? t('expenses.form.deleteConfirm') : t('expenses.form.delete')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* --- ADJUNTOS --- */}
          {tab === 'adjuntos' && (
            <div className="max-w-2xl">
              {attachments.length > 0 ? (
                <ul className="space-y-2.5">
                  {attachments.map((a) => {
                    const { Icon, cls } = iconFor(a.mime, a.filename);
                    const main = (
                      <>
                        <span
                          className={`w-10 h-10 rounded-lg ${cls} flex items-center justify-center shrink-0`}
                        >
                          <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
                        </span>
                        <span className="flex-1 min-w-0 text-left">
                          <span className="block text-[15px] font-medium truncate">
                            {a.filename}
                          </span>
                          <span className="block text-[13px] text-faint">
                            {fmtSize(a.size, 'es')}
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li
                        key={a.id}
                        className="flex items-center gap-3 rounded-xl border border-app px-3.5 py-3"
                      >
                        {isImageAttachment(a) ? (
                          <button
                            type="button"
                            onClick={() => openViewer(a)}
                            className="flex flex-1 min-w-0 items-center gap-3"
                          >
                            {main}
                          </button>
                        ) : (
                          main
                        )}
                        <a
                          href={`/api/expenses/${expense.id}/attachments/${encodeURIComponent(a.id)}`}
                          download={a.filename}
                          className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center shrink-0"
                        >
                          <Download className="w-4 h-4" aria-hidden="true" />
                        </a>
                        <button
                          onClick={() => handleDeleteAttachment(a.id)}
                          className="w-9 h-9 rounded-lg text-muted hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[14px] text-faint py-8 text-center">{t('attachments.empty')}</p>
              )}

              <div className="mt-5">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                  }}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-app px-4 py-4 text-[14px] font-medium text-muted hover:bg-surface2 disabled:opacity-60"
                >
                  <Paperclip className="w-4 h-4" aria-hidden="true" />
                  {uploading ? t('attachments.uploading') : t('attachments.upload')}
                </button>
                <p className="text-[12px] text-faint mt-2 text-center">
                  {t('attachments.uploadHint')}
                </p>
                {uploadError && (
                  <p
                    role="alert"
                    className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2 text-center"
                  >
                    {uploadError}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* --- COMENTARIOS --- */}
          {tab === 'comentarios' && (
            <div className="max-w-2xl">
              {comments.length > 0 ? (
                <ul className="space-y-5">
                  {comments.map((c) => (
                    <li key={c.id} className="flex gap-3">
                      <Avatar name={c.username ?? '?'} color={c.user_color} size="lg" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px]">
                          <span className="font-semibold">{c.username ?? '?'}</span>{' '}
                          <span className="text-[12px] text-faint">{relTime(c.created_at, t)}</span>
                        </p>
                        <div className="mt-1 rounded-xl rounded-tl-sm bg-surface2 px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                          {c.body}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] text-faint py-8 text-center">{t('comments.empty')}</p>
              )}

              <form onSubmit={handleAddComment} className="flex gap-3 items-center mt-6">
                <Avatar name={user?.username ?? '?'} color={user?.color ?? 'slate'} size="lg" />
                <div className="flex-1 flex items-center gap-2 rounded-xl border border-app bg-surface px-3.5 py-2">
                  <input
                    type="text"
                    value={commentBody}
                    maxLength={2000}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder={t('comments.placeholder')}
                    className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
                  />
                  <button
                    type="submit"
                    disabled={commentSending || !commentBody.trim()}
                    className="px-3.5 py-2 rounded-lg bg-brand text-brandfg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
                  >
                    {commentSending ? t('comments.submitting') : t('comments.submit')}
                  </button>
                </div>
              </form>
              {commentError && (
                <p
                  role="alert"
                  className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2"
                >
                  {commentError}
                </p>
              )}
            </div>
          )}

          {/* --- ACTIVIDAD --- */}
          {tab === 'actividad' && (
            <div className="max-w-2xl">
              {activity.length === 0 ? (
                <p className="text-[14px] text-faint py-8 text-center">{t('activity.empty')}</p>
              ) : (
                <ul className="timeline space-y-4">
                  {activity.map((e) => {
                    const Icon = EVENT_ICON[e.type] ?? Plus;
                    return (
                      <li key={e.id} className="flex gap-3 items-center">
                        <span className="relative z-10 w-7 h-7 rounded-full bg-surface2 border border-app text-faint flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <p className="text-[14px] text-muted leading-relaxed">
                          <strong>{e.username ?? '?'}</strong> {e.type}
                          {e.data &&
                            typeof e.data === 'object' &&
                            Object.keys(e.data).length > 0 && (
                              <span className="text-faint"> {JSON.stringify(e.data)}</span>
                            )}
                          <span className="text-faint"> · {relTime(e.created_at, t)}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      <ImageLightbox images={images} index={viewer} onIndexChange={setViewer} />
      <PhotoCropDialog
        file={cropFile}
        open={!!cropFile}
        onClose={() => setCropFile(null)}
        onSave={handleCropSave}
        allowedRatios={[4 / 3, 16 / 9, 1, 0]}
      />
    </div>
  );
}
