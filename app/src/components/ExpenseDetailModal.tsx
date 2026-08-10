import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, FileText, Paperclip, MessageSquare, Clock, Trash2 } from 'lucide-react'
import { useData } from '@/data/data-context'
import { useSession } from '@/auth/session-context'
import type { Expense, ExpenseSplitType, ExpenseStep, PaymentMethod } from '@/data/types'
import { colorOf } from '@/lib/colors'
import { PhotoCropDialog } from '@/components/PhotoCropDialog'

type Tab = 'detalles' | 'adjuntos' | 'comentarios' | 'actividad'

const STEPS: ExpenseStep[] = ['nuevo', 'en-curso', 'hecho']
const TABS: { id: Tab; icon: typeof FileText }[] = [
  { id: 'detalles', icon: FileText },
  { id: 'adjuntos', icon: Paperclip },
  { id: 'comentarios', icon: MessageSquare },
  { id: 'actividad', icon: Clock },
]

function fmtEur(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC'
}

interface Props {
  expense: Expense
  onClose: () => void
  onDeleted: () => void
}

export function ExpenseDetailModal({ expense: initialExpense, onClose, onDeleted }: Props) {
  const { t } = useTranslation()
  const data = useData()
  const { user } = useSession()
  const modalRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('detalles')
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [showCropper, setShowCropper] = useState<File | null>(null)

  // Detail cache
  const detail = data.getExpenseDetail(initialExpense.id) ?? null
  const expense = detail?.expense ?? initialExpense

  // Form state
  const [title, setTitle] = useState(expense.title)
  const [amountText, setAmountText] = useState((expense.amount_cents / 100).toFixed(2).replace('.', ','))
  const [labelId, setLabelId] = useState<string | null>(expense.label_id)
  const [notes, setNotes] = useState(expense.notes)
  const [paidByCreator, setPaidByCreator] = useState(expense.paid_by_creator)
  const [requestedUserId, setRequestedUserId] = useState<string | null>(expense.requested_user_id)
  const [splitType, setSplitType] = useState<ExpenseSplitType | null>(expense.split_type)
  const [splitAmountText, setSplitAmountText] = useState(
    expense.split_amount_cents ? (expense.split_amount_cents / 100).toFixed(2).replace('.', ',') : ''
  )
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(expense.payment_method)
  const [commentText, setCommentText] = useState('')
  const [commentSending, setCommentSending] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Sync title/notes on SSE refresh
  useEffect(() => {
    if (detail?.expense) {
      setTitle(detail.expense.title)
      setNotes(detail.expense.notes)
    }
  }, [detail?.expense])

  useEffect(() => {
    const t = deleteArmed ? window.setTimeout(() => setDeleteArmed(false), 4000) : undefined
    return () => { if (t) clearTimeout(t) }
  }, [deleteArmed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      data.releaseExpenseDetail(expense.id)
    }
  }, [onClose, data, expense.id])

  useEffect(() => {
    void data.refreshExpenseDetail(expense.id)
  }, [expense.id])

  const labels = data.getLabels()
  const users = data.getUsers().filter((u) => u.id !== user?.id)
  const isCreator = expense.created_by === user?.id
  const isRequested = expense.requested_user_id === user?.id

  const parseAmount = (text: string) => {
    const n = parseFloat(text.replace(',', '.'))
    return isNaN(n) || n <= 0 ? null : Math.round(n * 100)
  }

  const patch = async (patch: Record<string, unknown>) => {
    try {
      await data.updateExpense(expense.id, patch)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 1500)
    } catch {
      setSaveState('error')
    }
  }

  const handleMove = (step: ExpenseStep) => {
    data.moveExpense(expense.id, step, 0)
  }

  const handleDelete = async () => {
    if (!deleteArmed) { setDeleteArmed(true); return }
    try {
      await data.deleteExpense(expense.id)
      onDeleted()
    } catch {}
  }

  const handlePayMyPart = async () => {
    await data.updateExpense(expense.id, { paid_by_requested: true })
  }

  const handleAddComment = async () => {
    if (!commentText.trim() || commentSending) return
    setCommentSending(true)
    try {
      await data.addExpenseComment(expense.id, commentText.trim())
      setCommentText('')
    } catch {}
    setCommentSending(false)
  }

  const handleFileSelected = (file: File) => setShowCropper(file)

  const handleCropped = async (blob: Blob) => {
    setShowCropper(null)
    setUploading(true)
    try {
      await data.uploadExpenseAttachment(expense.id, new File([blob], 'ticket.webp', { type: 'image/webp' }))
    } catch {}
    setUploading(false)
  }

  const handleDeleteAttachment = async (attId: string) => {
    await data.deleteExpenseAttachment(expense.id, attId)
  }

  const getSplitLabel = () => {
    if (!splitType && !expense.split_type) return null
    const st = splitType ?? expense.split_type
    if (st === 'half') return t('expenses.splitHalf')
    if (st === 'custom') return fmtEur(splitAmountText ? Math.round(parseFloat(splitAmountText.replace(',', '.')) * 100) : (expense.split_amount_cents ?? 0))
    return t('expenses.splitFull')
  }

  const attachments = detail?.attachments ?? []
  const comments = detail?.comments ?? []
  const activity = detail?.activity ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div ref={modalRef} className="relative w-full max-w-2xl bg-surface rounded-2xl shadow-xl border border-border-app overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header con tabs */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-app">
          <div className="flex items-center gap-1">
            {TABS.map((tabDef) => (
              <button
                key={tabDef.id}
                onClick={() => setTab(tabDef.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  tab === tabDef.id ? 'bg-brand text-brandfg' : 'text-text-muted hover:bg-surface2 hover:text-text-secondary'
                }`}
              >
                <tabDef.icon size={14} />
                <span className="hidden sm:inline">{t(`task.tabs.${tabDef.id}`)}</span>
                {tabDef.id === 'adjuntos' && attachments.length > 0 && (
                  <span className="text-[10px]">{attachments.length}</span>
                )}
                {tabDef.id === 'comentarios' && comments.length > 0 && (
                  <span className="text-[10px]">{comments.length}</span>
                )}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:bg-surface2 hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'detalles' && (
            <div className="p-5 space-y-4">
              {/* Título */}
              <div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => { if (title !== expense.title) patch({ title }) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
                  className="w-full text-lg font-semibold bg-transparent text-text-primary placeholder:text-text-muted outline-none"
                />
              </div>

              {/* Columna */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('newTask.column')}</label>
                <div className="flex gap-1.5">
                  {STEPS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleMove(s)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        expense.step === s ? 'bg-brand/15 text-brand' : 'text-text-muted hover:bg-surface2 border border-border-app'
                      }`}
                    >
                      {t(`expenseSteps.${s}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Importe */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('expenses.amount')}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  onBlur={() => {
                    const cents = parseAmount(amountText)
                    if (cents && cents !== expense.amount_cents) patch({ amount_cents: cents })
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-surface2 border border-border-app text-sm text-text-primary focus:outline-none focus:border-brand"
                />
              </div>

              {/* Categoría */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('expenses.category')}</label>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => { setLabelId(null); patch({ label_id: null }) }}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${!labelId ? 'bg-brand/15 text-brand' : 'text-text-muted hover:bg-surface2'}`}>
                    {t('common.none')}
                  </button>
                  {labels.map((l) => {
                    const c = colorOf(l.color)
                    return (
                      <button key={l.id} onClick={() => { setLabelId(l.id); patch({ label_id: l.id }) }}
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={labelId === l.id ? { backgroundColor: c.chip + '30', color: c.chip } : {}}>
                        {l.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Método de pago */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('expenses.paymentMethod')}</label>
                <div className="flex gap-1.5">
                  {(['bizum', 'transfer', 'efectivo'] as const).map((m) => (
                    <button key={m} onClick={() => {
                      const next = paymentMethod === m ? null : m
                      setPaymentMethod(next)
                      patch({ payment_method: next })
                    }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        paymentMethod === m ? 'bg-brand/15 text-brand' : 'text-text-muted hover:bg-surface2 border border-border-app'
                      }`}>
                      {t(`expenses.${m}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('expenses.notes')}</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => { if (notes !== expense.notes) patch({ notes }) }}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-surface2 border border-border-app text-sm text-text-primary focus:outline-none focus:border-brand resize-none"
                />
              </div>

              {/* Yo pagué */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={paidByCreator}
                  onChange={(e) => { setPaidByCreator(e.target.checked); patch({ paid_by_creator: e.target.checked }) }}
                  className="w-4 h-4 rounded border-border-strong text-brand focus:ring-brand" />
                <span className="text-sm text-text-secondary">{t('expenses.iPaid')}</span>
              </label>

              {/* Requerir pago */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('expenses.requestPayment')}</label>
                <select value={requestedUserId ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || null
                    setRequestedUserId(val)
                    if (!val) { setSplitType(null); patch({ requested_user_id: null, split_type: null }) }
                    else patch({ requested_user_id: val })
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-surface2 border border-border-app text-sm text-text-primary focus:outline-none focus:border-brand">
                  <option value="">{t('expenses.noRequest')}</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
              </div>

              {requestedUserId && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('expenses.split')}</label>
                  <div className="flex gap-1.5">
                    {(['half', 'custom', 'full'] as const).map((s) => (
                      <button key={s} onClick={() => { setSplitType(s); patch({ split_type: s }) }}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                          splitType === s ? 'bg-brand/15 text-brand' : 'text-text-muted hover:bg-surface2 border border-border-app'
                        }`}>
                        {t(`expenses.split${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                      </button>
                    ))}
                  </div>
                  {splitType === 'custom' && (
                    <input type="text" inputMode="decimal" value={splitAmountText}
                      onChange={(e) => setSplitAmountText(e.target.value)}
                      onBlur={() => {
                        const n = parseFloat(splitAmountText.replace(',', '.'))
                        if (!isNaN(n)) patch({ split_amount_cents: Math.round(n * 100) })
                      }}
                      className="mt-2 w-full px-3 py-2 rounded-lg bg-surface2 border border-border-app text-sm text-text-primary focus:outline-none focus:border-brand"
                    />
                  )}
                </div>
              )}

              {/* Sección del requerido */}
              {isRequested && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {expense.created_by_username} {t('expenses.requestPayment')}: {getSplitLabel() ?? fmtEur(expense.amount_cents)}
                  </p>
                  {expense.paid_by_requested ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">{t('expenses.payMyPartDone')}</p>
                  ) : (
                    <button onClick={handlePayMyPart}
                      className="mt-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600">
                      {t('expenses.payMyPart')}
                    </button>
                  )}
                </div>
              )}

              {saveState === 'saved' && <p className="text-xs text-emerald-600">{t('task.saved')}</p>}
              {saveState === 'error' && <p className="text-xs text-rose-600">{t('task.saveError')}</p>}

              {/* Delete */}
              {isCreator && (
                <div className="pt-4 border-t border-border-app">
                  <button onClick={handleDelete}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      deleteArmed ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                      : 'text-text-muted hover:bg-rose-50 hover:text-rose-600'
                    }`}>
                    <Trash2 size={14} className="inline mr-1" />
                    {deleteArmed ? t('expenses.form.deleteConfirm') : t('expenses.form.delete')}
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'adjuntos' && (
            <div className="p-5 space-y-3">
              {uploading && <p className="text-xs text-text-muted">{t('attachments.uploading')}</p>}
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand/10 text-brand hover:bg-brand/20 cursor-pointer transition-colors">
                {t('attachments.upload')}
                <input type="file" accept="image/*,.pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = '' }} />
              </label>
              {attachments.length === 0 && !uploading && (
                <p className="text-xs text-text-muted py-4">{t('attachments.empty')}</p>
              )}
              {attachments.map((att) => (
                <div key={att.id} className="flex items-center justify-between p-2 rounded-lg bg-surface2 border border-border-app">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{att.filename}</p>
                    <p className="text-[10px] text-text-muted">{(att.size / 1024).toFixed(0)} KB · {att.mime.split('/')[0]}</p>
                  </div>
                  <div className="flex gap-1 ml-2">
                    <a href={`/api/expenses/${expense.id}/attachments/${att.id}`} target="_blank" rel="noopener"
                      className="px-2 py-0.5 rounded text-[10px] font-medium text-brand hover:bg-brand/10">
                      {t('attachments.download', { name: '' }).trim() || '↓'}
                    </a>
                    <button onClick={() => handleDeleteAttachment(att.id)}
                      className="px-2 py-0.5 rounded text-[10px] font-medium text-rose-600 hover:bg-rose-50">
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'comentarios' && (
            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment() } }}
                  placeholder={t('comments.placeholder')}
                  rows={2}
                  className="flex-1 px-3 py-2 rounded-lg bg-surface2 border border-border-app text-sm text-text-primary focus:outline-none focus:border-brand resize-none"
                />
                <button onClick={handleAddComment} disabled={!commentText.trim() || commentSending}
                  className="self-end px-3 py-2 rounded-lg text-xs font-medium bg-brand text-brandfg disabled:opacity-50 hover:opacity-90">
                  {commentSending ? t('comments.submitting') : t('comments.submit')}
                </button>
              </div>
              {comments.length === 0 && <p className="text-xs text-text-muted py-4">{t('comments.empty')}</p>}
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <div className={`w-6 h-6 rounded-full flex-shrink-0 ${colorOf(c.user_color).chip} flex items-center justify-center text-[10px] font-semibold`}>
                    {(c.username || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-text-primary">{c.username}</p>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'actividad' && (
            <div className="p-5 space-y-2">
              {activity.length === 0 && <p className="text-xs text-text-muted">{t('activity.empty')}</p>}
              {activity.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2 text-xs">
                  <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-semibold bg-surface2`}>
                    {(ev.username || '?')[0].toUpperCase()}
                  </div>
                  <span className="text-text-muted">
                    <strong>{ev.username}</strong> {ev.type}
                    {ev.data && Object.keys(ev.data).length > 0 && (
                      <span className="text-faint"> {JSON.stringify(ev.data)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCropper && (
        <PhotoCropDialog
          file={showCropper}
          open={true}
          onClose={() => setShowCropper(null)}
          onSave={handleCropped}
          maxLongSide={1200}
          quality={0.85}
        />
      )}
    </div>
  )
}
