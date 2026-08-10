import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Info, Paperclip, MessageCircle, Clock } from 'lucide-react'
import type { FormEvent } from 'react'
import { useData } from '@/data/data-context'
import { useSession } from '@/auth/session-context'
import type { Expense, ExpenseStep } from '@/data/types'
import type { Attachment, ActivityEvent, Comment } from '@/data/types'
import { colorOf } from '@/lib/colors'
import { Avatar } from '@/components/Avatar'
import { relTime } from '@/i18n'
import { apiErrorText } from '@/lib/errors'
import { fmtSize } from '@/lib/format'
import { ImageLightbox } from '@/components/task/ImageLightbox'
import { PhotoCropDialog } from '@/components/PhotoCropDialog'
import {
  FileText, FileSpreadsheet, FileImage, File as FileIcon, Download,
  Plus, Move, Flag, Calendar, User, Type
} from 'lucide-react'

const STEPS: ExpenseStep[] = ['nuevo', 'en-curso', 'hecho']
const MAX_BYTES = 10 * 1024 * 1024

type Tab = 'detalles' | 'adjuntos' | 'comentarios' | 'actividad'

const TABS: { id: Tab; icon: typeof Info }[] = [
  { id: 'detalles', icon: Info },
  { id: 'adjuntos', icon: Paperclip },
  { id: 'comentarios', icon: MessageCircle },
  { id: 'actividad', icon: Clock },
]

const EVENT_ICON: Record<string, typeof Plus> = {
  created: Plus, title: Type, amount: FileIcon, category: Flag,
  notes: FileText, paid: Calendar, requested: User, split: Move,
  payment_method: Type, moved: Move, attachment: Paperclip,
}

function fmtEur(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC'
}

function isImageAttachment(a: Attachment) {
  const ext = a.filename.split('.').pop()?.toLowerCase() ?? ''
  return a.mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
}

function iconFor(mime: string, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return { Icon: FileImage, cls: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' }
  }
  if (mime.includes('sheet') || mime.includes('csv') || ['xls', 'xlsx', 'ods', 'csv'].includes(ext)) {
    return { Icon: FileSpreadsheet, cls: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' }
  }
  if (mime === 'application/pdf' || ['pdf', 'doc', 'docx', 'odt', 'txt', 'md'].includes(ext)) {
    return { Icon: FileText, cls: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' }
  }
  return { Icon: FileIcon, cls: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' }
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
  const panelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('detalles')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [viewer, setViewer] = useState<number | null>(null)
  const lastFocus = useRef<Element | null>(null)

  const detail = data.getExpenseDetail(initialExpense.id)
  const expense = detail?.expense ?? initialExpense

  useEffect(() => {
    lastFocus.current = document.activeElement
    document.body.style.overflow = 'hidden'
    void data.refreshExpenseDetail(expense.id)
    return () => {
      document.body.style.overflow = ''
      data.releaseExpenseDetail(expense.id)
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus()
    }
  }, [expense.id])

  useEffect(() => {
    const t = deleteArmed ? window.setTimeout(() => setDeleteArmed(false), 4000) : undefined
    return () => { if (t) clearTimeout(t) }
  }, [deleteArmed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const labels = data.getLabels()
  const users = data.getUsers().filter((u) => u.id !== user?.id)
  const isCreator = expense.created_by === user?.id

  const patch = async (p: Record<string, unknown>) => { await data.updateExpense(expense.id, p) }

  // --- Comments ---
  const [commentBody, setCommentBody] = useState('')
  const [commentSending, setCommentSending] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  const handleAddComment = async (e: FormEvent) => {
    e.preventDefault()
    const text = commentBody.trim()
    if (!text || commentSending) return
    setCommentSending(true)
    setCommentError(null)
    try { await data.addExpenseComment(expense.id, text); setCommentBody('') }
    catch (err) { setCommentError(apiErrorText(err, t('comments.error'))) }
    finally { setCommentSending(false) }
  }

  // --- Attachments ---
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFile = (file: File | undefined) => {
    if (!file) return
    setUploadError(null)
    if (file.size > MAX_BYTES) { setUploadError(t('attachments.tooBig')); return }
    if (file.type.startsWith('image/')) { setCropFile(file); if (fileInputRef.current) fileInputRef.current.value = ''; return }
    doUpload(file)
  }

  const doUpload = async (file: File) => {
    setUploading(true)
    try { await data.uploadExpenseAttachment(expense.id, file) }
    catch (err) { setUploadError(apiErrorText(err, t('attachments.uploadError'))) }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const handleCropSave = async (blob: Blob) => {
    setUploadError(null)
    setUploading(true)
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
    try { await data.uploadExpenseAttachment(expense.id, new File([blob], `photo.${ext}`, { type: blob.type })) }
    catch (err) { setUploadError(apiErrorText(err, t('attachments.uploadError'))) }
    finally { setUploading(false) }
  }

  const handleDeleteAttachment = async (attId: string) => {
    await data.deleteExpenseAttachment(expense.id, attId)
  }

  const handleDeleteExpense = async () => {
    if (!deleteArmed) { setDeleteArmed(true); return }
    try { await data.deleteExpense(expense.id); onDeleted() } catch {}
  }

  const handleMove = (step: ExpenseStep) => { data.moveExpense(expense.id, step, 0) }
  const handlePayMyPart = () => { data.updateExpense(expense.id, { paid_by_requested: true }) }

  const attachments: Attachment[] = detail?.attachments ?? []
  const comments: Comment[] = detail?.comments ?? []
  const activity: ActivityEvent[] = detail?.activity ?? []

  const images = attachments.filter(isImageAttachment).map((a) => ({
    src: `/api/expenses/${expense.id}/attachments/${encodeURIComponent(a.id)}`,
    alt: a.filename,
  }))

  const openViewer = (a: Attachment) => {
    const i = images.findIndex((img) => img.src.endsWith(encodeURIComponent(a.id)))
    if (i >= 0) setViewer(i)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[3vh] px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div ref={panelRef} className="relative w-full max-w-4xl max-h-[95vh] bg-surface rounded-2xl shadow-xl border border-border-app overflow-hidden flex flex-col">

        {/* Header con tabs — mismo diseño que TaskModal */}
        <div className="flex items-center justify-between px-3 md:px-5 py-2 border-b border-border-app">
          <div className="flex items-center gap-1">
            {TABS.map((tb) => (
              <button key={tb.id} onClick={() => setTab(tb.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  tab === tb.id ? 'bg-brand text-brandfg' : 'text-muted hover:bg-surface2'}`}>
                <tb.icon size={15} />
                <span className="hidden sm:inline">{t(`task.tabs.${tb.id}`)}</span>
                {tb.id === 'adjuntos' && attachments.length > 0 && <span className="text-[11px] opacity-70">{attachments.length}</span>}
                {tb.id === 'comentarios' && comments.length > 0 && <span className="text-[11px] opacity-70">{comments.length}</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-faint hidden sm:inline tabular-nums">{expense.title.slice(0, 30)}</span>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:bg-surface2 hover:text-text">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-3 md:p-5">

          {/* --- DETALLES --- */}
          {tab === 'detalles' && (
            <div className="space-y-5 max-w-2xl">
              {/* Título editable */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1">{t('expenses.form.titleLabel')}</p>
                  <input type="text" value={detail?.expense?.title ?? expense.title}
                    onChange={() => {}}
                    onBlur={(e) => { if (e.target.value && e.target.value !== expense.title) patch({ title: e.target.value }) }}
                    className="w-full bg-transparent text-[16px] font-medium outline-none border-b border-transparent focus:border-brand pb-0.5"
                    defaultValue={expense.title}
                  />
                </div>
              </div>

              {/* Columna */}
              <div>
                <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('newTask.column')}</p>
                <div className="flex gap-1.5">
                  {STEPS.map((s) => (
                    <button key={s} onClick={() => handleMove(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        expense.step === s ? 'bg-brand/15 text-brand' : 'text-text-muted hover:bg-surface2 border border-border-app'}`}>
                      {t(`expenseSteps.${s}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Importe */}
              <div>
                <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.amount')}</p>
                <div className="flex items-center gap-2">
                  <input type="text" inputMode="decimal"
                    defaultValue={(expense.amount_cents / 100).toFixed(2).replace('.', ',')}
                    onBlur={(e) => {
                      const n = parseFloat(e.target.value.replace(',', '.'))
                      if (!isNaN(n) && n > 0) patch({ amount_cents: Math.round(n * 100) })
                    }}
                    className="w-28 px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text-primary focus:outline-none focus:border-brand"
                  />
                  <span className="text-sm text-text-muted">EUR</span>
                </div>
              </div>

              {/* Categoría */}
              <div>
                <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.category')}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => patch({ label_id: null })}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${!expense.label_id ? 'bg-brand/15 text-brand' : 'text-text-muted hover:bg-surface2'}`}>
                    {t('common.none')}
                  </button>
                  {labels.map((l) => {
                    const c = colorOf(l.color)
                    return (
                      <button key={l.id} onClick={() => patch({ label_id: l.id })}
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={expense.label_id === l.id ? { backgroundColor: c.chip + '30', color: c.chip } : {}}>
                        {l.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Método de pago */}
              <div>
                <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.paymentMethod')}</p>
                <div className="flex gap-1.5">
                  {(['bizum', 'transfer', 'efectivo'] as const).map((m) => (
                    <button key={m} onClick={() => patch({ payment_method: expense.payment_method === m ? null : m })}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        expense.payment_method === m ? 'bg-brand/15 text-brand' : 'text-text-muted hover:bg-surface2 border border-border-app'}`}>
                      {t(`expenses.${m}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notas */}
              <div>
                <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.notes')}</p>
                <textarea defaultValue={expense.notes}
                  onBlur={(e) => { if (e.target.value !== expense.notes) patch({ notes: e.target.value }) }}
                  rows={3} placeholder={t('expenses.form.notesPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text-primary focus:outline-none focus:border-brand resize-none" />
              </div>

              {/* Yo pagué */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={expense.paid_by_creator}
                  onChange={(e) => patch({ paid_by_creator: e.target.checked })}
                  className="w-4 h-4 rounded border-border-strong text-brand focus:ring-brand" />
                <span className="text-sm text-text-secondary">{t('expenses.iPaid')}</span>
              </label>

              {/* Requerir pago */}
              <div>
                <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.requestPayment')}</p>
                <select value={expense.requested_user_id ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || null
                    if (!val) patch({ requested_user_id: null, split_type: null })
                    else patch({ requested_user_id: val })
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text-primary focus:outline-none focus:border-brand">
                  <option value="">{t('expenses.noRequest')}</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
              </div>

              {expense.requested_user_id && (
                <div>
                  <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">{t('expenses.split')}</p>
                  <div className="flex gap-1.5">
                    {(['half', 'custom', 'full'] as const).map((s) => (
                      <button key={s} onClick={() => patch({ split_type: s })}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                          expense.split_type === s ? 'bg-brand/15 text-brand' : 'text-text-muted hover:bg-surface2 border border-border-app'}`}>
                        {t(`expenses.split${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sección del requerido */}
              {expense.requested_user_id === user?.id && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {expense.created_by_username} {t('expenses.requestPayment').toLowerCase()}: {fmtEur(
                      expense.split_type === 'half' ? Math.round(expense.amount_cents / 2)
                      : expense.split_type === 'custom' ? (expense.split_amount_cents ?? expense.amount_cents)
                      : expense.amount_cents
                    )}
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

              {/* Delete */}
              {isCreator && (
                <div className="pt-4 border-t border-app">
                  <button onClick={handleDeleteExpense}
                    className={`px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                      deleteArmed ? 'bg-rose-600 text-white' : 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20'}`}>
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
                    const { Icon, cls } = iconFor(a.mime, a.filename)
                    const main = (
                      <>
                        <span className={`w-10 h-10 rounded-lg ${cls} flex items-center justify-center shrink-0`}>
                          <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
                        </span>
                        <span className="flex-1 min-w-0 text-left">
                          <span className="block text-[15px] font-medium truncate">{a.filename}</span>
                          <span className="block text-[13px] text-faint">{fmtSize(a.size, 'es')}</span>
                        </span>
                      </>
                    )
                    return (
                      <li key={a.id} className="flex items-center gap-3 rounded-xl border border-app px-3.5 py-3">
                        {isImageAttachment(a) ? (
                          <button type="button" onClick={() => openViewer(a)}
                            className="flex flex-1 min-w-0 items-center gap-3">
                            {main}
                          </button>
                        ) : main}
                        <a href={`/api/expenses/${expense.id}/attachments/${encodeURIComponent(a.id)}`} download={a.filename}
                          className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center shrink-0">
                          <Download className="w-4 h-4" aria-hidden="true" />
                        </a>
                        <button onClick={() => handleDeleteAttachment(a.id)}
                          className="w-9 h-9 rounded-lg text-muted hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center shrink-0">
                          <X size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-[14px] text-faint py-8 text-center">{t('attachments.empty')}</p>
              )}

              <div className="mt-5">
                <input ref={fileInputRef} type="file" className="sr-only" aria-hidden="true" tabIndex={-1}
                  onChange={(e) => { handleFile(e.target.files?.[0]) }} />
                <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-app px-4 py-4 text-[14px] font-medium text-muted hover:bg-surface2 disabled:opacity-60">
                  <Paperclip className="w-4 h-4" aria-hidden="true" />
                  {uploading ? t('attachments.uploading') : t('attachments.upload')}
                </button>
                <p className="text-[12px] text-faint mt-2 text-center">{t('attachments.uploadHint')}</p>
                {uploadError && <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2 text-center">{uploadError}</p>}
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
                  <input type="text" value={commentBody} maxLength={2000}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder={t('comments.placeholder')}
                    className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
                  <button type="submit" disabled={commentSending || !commentBody.trim()}
                    className="px-3.5 py-2 rounded-lg bg-brand text-brandfg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60">
                    {commentSending ? t('comments.submitting') : t('comments.submit')}
                  </button>
                </div>
              </form>
              {commentError && <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2">{commentError}</p>}
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
                    const Icon = EVENT_ICON[e.type] ?? Plus
                    return (
                      <li key={e.id} className="flex gap-3 items-center">
                        <span className="relative z-10 w-7 h-7 rounded-full bg-surface2 border border-app text-faint flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <p className="text-[14px] text-muted leading-relaxed">
                          <strong>{e.username ?? '?'}</strong> {e.type}
                          {e.data && typeof e.data === 'object' && Object.keys(e.data).length > 0 && (
                            <span className="text-faint"> {JSON.stringify(e.data)}</span>
                          )}
                          <span className="text-faint"> · {relTime(e.created_at, t)}</span>
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <ImageLightbox images={images} index={viewer} onIndexChange={setViewer} />
      <PhotoCropDialog file={cropFile} open={!!cropFile} onClose={() => setCropFile(null)}
        onSave={handleCropSave} allowedRatios={[4 / 3, 16 / 9, 1, 0]} />
    </div>
  )
}
