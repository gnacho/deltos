import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '@/data/data-context'
import { useSession } from '@/auth/session-context'
import type { Expense, ExpenseStep } from '@/data/types'
import { ExpenseCard } from '@/components/ExpenseCard'
import { ExpenseModal } from '@/components/ExpenseModal'
import { colorOf } from '@/lib/colors'
import { Plus } from 'lucide-react'

const STEPS: ExpenseStep[] = ['nuevo', 'en-curso', 'hecho']

const STEP_COLORS: Record<ExpenseStep, string> = {
  'nuevo': 'sky',
  'en-curso': 'amber',
  'hecho': 'emerald',
}

type FilterType = 'all' | 'owe' | 'owed' | 'unpaid' | 'paid'

export default function ExpenseBoard() {
  const { t } = useTranslation()
  const data = useData()
  const { user } = useSession()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')

  const expenses = data.getExpenses()

  const filtered = useMemo(() => {
    if (filter === 'all') return expenses
    if (filter === 'owe') return expenses.filter((e) => e.requested_user_id === user?.id && !e.paid_by_requested)
    if (filter === 'owed') return expenses.filter((e) => e.created_by === user?.id && e.requested_user_id && !e.paid_by_requested)
    if (filter === 'unpaid') return expenses.filter((e) => !e.paid_by_creator || (e.requested_user_id && !e.paid_by_requested))
    if (filter === 'paid') return expenses.filter((e) => e.paid_by_creator && (!e.requested_user_id || e.paid_by_requested))
    return expenses
  }, [expenses, filter, user])

  const byStep = useMemo(() => {
    const map = new Map<ExpenseStep, Expense[]>()
    for (const s of STEPS) {
      map.set(s, filtered.filter((e) => e.step === s).sort((a, b) => a.position - b.position))
    }
    return map
  }, [filtered])

  const openTotal = expenses.filter((e) => e.step !== 'hecho').length

  const handleCreated = (_expense: Expense) => {
    setCreating(false)
  }

  const handleUpdated = () => {
    setEditing(null)
  }

  const handleMove = (id: string, step: ExpenseStep) => {
    const targetList = byStep.get(step) || []
    data.moveExpense(id, step, targetList.length)
  }

  if (!data.ready) return null

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-border-app">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{t('expenses.title')}</h1>
          <p className="text-sm text-text-muted">
            {t('expenses.subtitle')}
            {openTotal > 0 && ` · ${openTotal} ${t('expenses.filterUnpaid').toLowerCase()}`}
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-brand text-brandfg hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          {t('expenses.form.createTitle')}
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-1.5 px-4 md:px-6 py-2 border-b border-border-app overflow-x-auto">
        {([
          ['all', t('board.scopeAll')],
          ['owe', t('expenses.filterOwe')],
          ['owed', t('expenses.filterOwed')],
          ['unpaid', t('expenses.filterUnpaid')],
          ['paid', t('expenses.filterPaid')],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === key
                ? 'bg-brand/15 text-brand'
                : 'text-text-muted hover:bg-surface2 hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Columnas */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:gap-0 p-4 md:p-6 h-full">
          {STEPS.map((step) => {
            const items = byStep.get(step) || []
            const color = STEP_COLORS[step]
            const c = colorOf(color)
            return (
              <div key={step} className="flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: c.dot }}
                  />
                  <h2 className="text-sm font-semibold text-text-primary">
                    {t(`expenseSteps.${step}`)}
                  </h2>
                  <span className="text-xs text-text-muted tabular-nums">{items.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[100px]">
                  {items.length === 0 ? (
                    <p className="text-xs text-text-muted py-4 text-center">{t('board.emptyColumn')}</p>
                  ) : (
                    items.map((expense) => (
                      <ExpenseCard
                        key={expense.id}
                        expense={expense}
                        onClick={() => setEditing(expense)}
                        onMove={handleMove}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {creating && (
        <ExpenseModal
          mode="create"
          onClose={() => setCreating(false)}
          onCreated={handleCreated}
        />
      )}
      {editing && (
        <ExpenseModal
          mode="edit"
          expense={editing}
          onClose={() => setEditing(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  )
}
