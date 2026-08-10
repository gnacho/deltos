import { useTranslation } from 'react-i18next'
import type { Expense, ExpenseStep } from '@/data/types'
import { colorOf } from '@/lib/colors'
import { Avatar } from '@/components/Avatar'
import { useData } from '@/data/data-context'

interface Props {
  expense: Expense
  onClick: () => void
  onMove: (id: string, step: ExpenseStep) => void
}

function fmtEur(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20AC'
}

export function ExpenseCard({ expense, onClick, onMove }: Props) {
  const { t } = useTranslation()
  const data = useData()

  const creator = data.getUsers().find((u) => u.id === expense.created_by)
  const requested = expense.requested_user_id
    ? data.getUsers().find((u) => u.id === expense.requested_user_id)
    : null

  const getSplitLabel = () => {
    if (!expense.split_type) return null
    if (expense.split_type === 'half') return t('expenses.splitHalf')
    if (expense.split_type === 'custom') return fmtEur(expense.split_amount_cents || 0)
    return t('expenses.splitFull')
  }

  const labelColor = expense.label_color ? colorOf(expense.label_color) : null

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-xl bg-surface border border-border-app hover:border-border-strong transition-colors shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{expense.title}</p>
          <p className="text-sm font-semibold text-text-primary mt-0.5">{fmtEur(expense.amount_cents)}</p>
        </div>
        {creator && (
          <Avatar name={creator.username} color={creator.color} size="sm" />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2">
        {expense.label_name && labelColor && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{ backgroundColor: labelColor.chip + '20', color: labelColor.chip }}
          >
            {expense.label_name}
          </span>
        )}
        {expense.paid_by_creator && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {t('expenses.paid')}
          </span>
        )}
        {requested && !expense.paid_by_requested && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            {getSplitLabel()} &rarr; {requested.username}
          </span>
        )}
        {requested && expense.paid_by_requested && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {getSplitLabel()} &rarr; {requested.username} &#10003;
          </span>
        )}
        {expense.notes && (
          <span className="text-[10px] text-text-muted truncate w-full mt-0.5">{expense.notes}</span>
        )}
      </div>

      {/* Step controls */}
      <div className="flex gap-1 mt-2 pt-2 border-t border-border-app">
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
          >
            {t(`expenseSteps.${s}`)}
          </button>
        ))}
      </div>
    </button>
  )
}
