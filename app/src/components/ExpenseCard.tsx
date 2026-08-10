import { MessageCircle, Paperclip } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Expense, ExpenseStep } from '@/data/types'
import { Avatar } from '@/components/Avatar'
import { TagChip } from '@/components/badges'
import { useData } from '@/data/data-context'

interface Props {
  expense: Expense
  index: number
  onOpen: (id: string) => void
  onMove: (id: string, step: ExpenseStep) => void
}

function fmtEur(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC'
}

export function ExpenseCard({ expense, index, onOpen, onMove }: Props) {
  const { t } = useTranslation()
  const data = useData()
  const done = expense.step === 'hecho'
  const delay = Math.min(index, 10) * 40

  const creator = data.getUsers().find((u) => u.id === expense.created_by)
  const label = expense.label_id ? { id: expense.label_id, name: expense.label_name ?? '', color: expense.label_color ?? 'slate' } : null

  const detail = data.getExpenseDetail(expense.id)
  const commentCount = detail?.comments?.length ?? 0
  const attachCount = detail?.attachments?.length ?? 0

  const getSplitLabel = () => {
    if (!expense.split_type) return null
    if (expense.split_type === 'half') return t('expenses.splitHalf')
    if (expense.split_type === 'custom') return fmtEur(expense.split_amount_cents || 0)
    return t('expenses.splitFull')
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(expense.id)}
      style={{ animationDelay: `${delay}ms` }}
      className={`card w-full text-left rounded-2xl bg-surface border border-app shadow-soft p-3.5 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md ${done ? 'opacity-60' : ''}`}
    >
      {label && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <TagChip label={label} />
        </div>
      )}

      <h3 className={`text-[15px] font-medium leading-snug ${done ? 'line-through decoration-1' : ''}`}>
        {expense.title}
      </h3>

      <p className="text-[15px] font-semibold text-text-primary mt-0.5">
        {fmtEur(expense.amount_cents)}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {expense.paid_by_creator && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {t('expenses.paid')}
          </span>
        )}
        {expense.requested_user_id && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${expense.paid_by_requested ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
            {getSplitLabel()} &rarr; {expense.requested_username}
            {expense.paid_by_requested && ' \u2713'}
          </span>
        )}
        {expense.payment_method && (
          <span className="text-[10px] text-text-muted">
            {t(`expenses.${expense.payment_method}`)}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-app">
        <span className="tnum flex items-center gap-3 text-xs text-faint">
          {commentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
              {commentCount}
            </span>
          )}
          {attachCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
              {attachCount}
            </span>
          )}
        </span>
        {creator ? (
          <Avatar name={creator.username} color={creator.color} />
        ) : (
          <div className="w-6 h-6 rounded-full bg-surface2" />
        )}
      </div>

      {/* Step controls */}
      <div className="flex gap-1 mt-2 pt-2 border-t border-app">
        {(['nuevo', 'en-curso', 'hecho'] as const).map((s) => (
          <button
            key={s}
            onClick={(e) => {
              e.stopPropagation()
              if (s !== expense.step) onMove(expense.id, s)
            }}
            className={`flex-1 py-0.5 rounded text-[10px] font-medium transition-colors ${
              expense.step === s
                ? 'bg-brand/15 text-brand cursor-default'
                : 'text-text-muted hover:bg-surface2 hover:text-text-secondary'
            }`}
            aria-label={t(`expenseSteps.${s}`)}
          >
            {t(`expenseSteps.${s}`)}
          </button>
        ))}
      </div>
    </button>
  )
}
