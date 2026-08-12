import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, BarChart3 } from 'lucide-react';
import type { ExpenseStep } from '@/data/types';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { ExpenseCard, ExpenseCardMobile } from '@/components/ExpenseCard';
import { ExpenseDetailModal } from '@/components/ExpenseDetailModal';
import { ExpenseModal } from '@/components/ExpenseModal';
import { BalanceStrip, ExpenseSummary } from '@/components/ExpenseSummary';
import { MobileMoveCard } from '@/components/MobileMoveCard';
import { useKanbanDnD } from '@/hooks/useKanbanDnD';
import { useStepSwipe } from '@/hooks/useStepSwipe';
import { colorOf } from '@/lib/colors';
import { announce } from '@/lib/announce';

const STEPS: { id: ExpenseStep; color: string }[] = [
  { id: 'nuevo', color: 'sky' },
  { id: 'en-curso', color: 'amber' },
  { id: 'hecho', color: 'emerald' },
];

const STEP_ACCENT_RGB: Record<string, string> = {
  sky: '14 165 233',
  amber: '245 158 11',
  emerald: '16 185 129',
};

type FilterType = 'all' | 'mine' | 'others';

export default function ExpenseBoard() {
  const { t } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const [creating, setCreating] = useState(false);
  const [detailExpense, setDetailExpense] = useState<{ id: string } | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [seg, setSeg] = useState<ExpenseStep>('nuevo');
  const [view, setView] = useState<'tablero' | 'resumen'>('tablero');

  const boardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const expenses = data.getExpenses();

  const visible = useMemo(() => {
    let list = expenses;
    if (filter === 'mine')
      list = list.filter(
        (e) =>
          e.created_by === me?.id ||
          e.payer_id === me?.id ||
          e.shares.some((sh) => sh.user_id === me?.id),
      );
    else if (filter === 'others')
      list = list.filter(
        (e) =>
          e.created_by !== me?.id &&
          e.payer_id !== me?.id &&
          !e.shares.some((sh) => sh.user_id === me?.id),
      );
    return list;
  }, [expenses, filter, me?.id]);

  const byStep = useMemo(() => {
    const map = new Map<ExpenseStep, typeof expenses>();
    for (const s of STEPS) {
      map.set(
        s.id,
        visible.filter((e) => e.step === s.id).sort((a, b) => a.position - b.position),
      );
    }
    return map;
  }, [visible]);

  const openCount = visible.filter((e) => e.step !== 'hecho').length;

  const handleOpenNew = () => {
    setCreating(true);
  };

  /* ---------- DnD compartido (hook) ---------- */

  const doMove = async (id: string, toCol: ExpenseStep, refId: string | null) => {
    const expense = data.getExpense(id);
    if (!expense) return;
    const colExpenses = expenses
      .filter((e) => e.step === toCol && e.id !== id)
      .sort((a, b) => a.position - b.position);
    let position = colExpenses.length;
    if (refId) {
      const ri = colExpenses.findIndex((e) => e.id === refId);
      if (ri !== -1) position = ri;
    }
    const fromCol = expense.step;
    if (fromCol === toCol) return;
    if (fromCol === 'hecho') {
      if (!window.confirm(t('expenses.moveConfirmReopen'))) return;
    } else if (!(fromCol === 'en-curso' && toCol === 'hecho')) {
      if (!window.confirm(t('expenses.moveConfirm', { from: t(`expenseSteps.${fromCol}`), to: t(`expenseSteps.${toCol}`) }))) return;
    }
    try {
      await data.moveExpense(id, toCol, position);
      const colName = t(`expenseSteps.${toCol}`);
      announce(
        fromCol !== toCol
          ? t('board.movedTo', { title: expense.title, column: colName })
          : t('board.reordered', { title: expense.title, column: colName }),
      );
    } catch {
      announce(t('common.error'));
    }
  };

  const dnd = useKanbanDnD<ExpenseStep>({
    boardRef,
    items: expenses,
    onMove: (id, toCol, refId) => void doMove(id, toCol, refId),
  });

  const doMoveMobile = (id: string, toStep: string) => {
    const expense = data.getExpense(id);
    if (!expense || expense.step === toStep) return;
    const fromCol = expense.step;
    if (fromCol === 'hecho') {
      if (!window.confirm(t('expenses.moveConfirmReopen'))) return;
    } else if (!(fromCol === 'en-curso' && toStep === 'hecho')) {
      if (!window.confirm(t('expenses.moveConfirm', { from: t(`expenseSteps.${fromCol}`), to: t(`expenseSteps.${toStep}`) }))) return;
    }
    const position = expenses.filter((e) => e.step === toStep && e.id !== id).length;
    void (async () => {
      try {
        await data.moveExpense(id, toStep, position);
        announce(t('board.movedTo', { title: expense.title, column: t(`expenseSteps.${toStep}`) }));
      } catch {
        announce(t('common.error'));
      }
    })();
  };

  useStepSwipe<ExpenseStep>(listRef, STEPS.map((st) => st.id), seg, setSeg, data.ready);

  if (!data.ready) {
    if (data.bootstrapError) {
      return (
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
          <div className="rounded-2xl bg-surface border border-app shadow-soft p-8 text-center max-w-md mx-auto">
            <p className="text-[15px] font-medium mb-1">{t('common.error')}</p>
            <p className="text-sm text-muted mb-4">{data.bootstrapError}</p>
            <button
              type="button"
              onClick={data.refresh}
              className="px-5 py-2.5 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110"
            >
              {t('common.retry')}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7" role="status">
        <div className="animate-pulse space-y-3">
          <div className="h-8 w-48 rounded-lg bg-surface2" />
          <div className="grid lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-surface2" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const scopes: Array<{ id: FilterType; label: string }> = [
    { id: 'all', label: t('board.scopeAll') },
    { id: 'mine', label: t('board.scopeMine') },
    { id: 'others', label: t('board.scopeOthers') },
  ];

  return (
    <div>
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
        {/* Botón "Resumen" (toggle): pulsado = vista resumen; sin pulsar = tablero */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={view === 'resumen'}
            onClick={() => setView(view === 'resumen' ? 'tablero' : 'resumen')}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 h-9 text-[13px] font-medium transition-colors ${
              view === 'resumen'
                ? 'bg-brand/10 text-brand ring-1 ring-brand/40'
                : 'bg-surface border border-app text-muted hover:bg-surface2 hover:text-text'
            }`}
          >
            <BarChart3 className="w-4 h-4" aria-hidden="true" />
            {t('expenses.summary')}
          </button>

          {view === 'tablero' && (
            <div
              role="tablist"
              aria-label={t('board.scopeAria')}
              className="inline-flex items-center gap-1 rounded-full bg-surface2 p-1"
            >
              {scopes.map((s) => {
                const active = filter === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(s.id)}
                    className={`rounded-full px-3.5 h-9 text-[13px] font-medium whitespace-nowrap transition-colors ${
                      active ? 'bg-surface shadow-soft text-text' : 'text-muted hover:text-text'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => handleOpenNew()}
            className="ml-auto hidden lg:inline-flex items-center gap-2 rounded-2xl bg-brand text-brandfg px-5 py-2.5 text-[14px] font-semibold hover:brightness-110 shadow-soft"
            aria-label={t('expenses.new')}
          >
            <Plus className="w-5 h-5" aria-hidden="true" />
            {t('expenses.new')}
          </button>
        </div>

        {view === 'resumen' ? (
          <div className="pb-8">
            <ExpenseSummary expenses={expenses} />
          </div>
        ) : (
          <>
            {/* BalanceStrip en desktop: arriba */}
            <div className="hidden lg:block mb-5">
              <BalanceStrip expenses={expenses} />
            </div>

            {/* ============ SEGMENTED CONTROL MÓVIL: justo sobre las tareas ============ */}
            <div data-segbar className="lg:hidden mb-3">
              <div
                role="tablist"
                aria-label={t('board.statesAria')}
                className="flex items-center gap-1 rounded-full bg-surface2 p-1"
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-seg]');
                  if (!b) return;
                  e.preventDefault();
                  const tabsEl = Array.from(
                    (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-seg]'),
                  );
                  const i = tabsEl.indexOf(b);
                  const next =
                    tabsEl[(i + (e.key === 'ArrowRight' ? 1 : tabsEl.length - 1)) % tabsEl.length];
                  setSeg(next.dataset.seg as ExpenseStep);
                  next.focus();
                }}
              >
                {STEPS.map((st) => {
                  const n = byStep.get(st.id)?.length ?? 0;
                  const active = seg === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      role="tab"
                      data-seg={st.id}
                      aria-selected={active}
                      aria-label={t('board.segAria', { column: t(`expenseSteps.${st.id}`), count: n })}
                      onClick={() => setSeg(st.id)}
                      className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-full px-2 h-11 text-[13px] font-medium whitespace-nowrap ${
                        active ? 'bg-surface shadow-soft' : 'text-muted'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${colorOf(st.color).dot}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{t(`expenseSteps.${st.id}`)}</span>
                      <span className={`tnum text-[12px] ${active ? 'text-muted' : 'text-faint'}`}>
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lista móvil (<lg): un solo estado */}
            <div
              ref={listRef}
              className="lg:hidden space-y-3 pb-4"
              aria-live="polite"
              aria-label={t('board.listAria')}
              style={{ touchAction: 'pan-y' }}
            >
              {(byStep.get(seg) ?? []).map((exp, i) => (
                <MobileMoveCard
                  key={exp.id}
                  id={exp.id}
                  current={exp.step}
                  steps={STEPS.map((st) => st.id)}
                  onMove={doMoveMobile}
                >
                  <ExpenseCardMobile
                    expense={exp}
                    index={i}
                    onOpen={(id) => setDetailExpense({ id })}
                  />
                </MobileMoveCard>
              ))}
              {(byStep.get(seg) ?? []).length === 0 && (
                <p className="rounded-2xl border border-dashed border-app px-4 py-8 text-center text-[15px] text-muted">
                  {t('expenses.emptyState', { column: t(`expenseSteps.${seg}`) })}
                </p>
              )}
            </div>

            {/* BalanceStrip en móvil: abajo de la lista */}
            <div className="lg:hidden pb-2">
              <BalanceStrip expenses={expenses} />
            </div>

            {/* Tablero escritorio (lg+): kanban 3 columnas con drag & drop */}
            <div
              ref={boardRef}
              className="hidden lg:grid lg:grid-cols-3 lg:items-start gap-4"
              aria-live="polite"
              onDragStart={dnd.onDragStart}
              onDragOver={dnd.onDragOver}
              onDrop={dnd.onDrop}
              onDragEnd={dnd.onDragEnd}
            >
              {STEPS.map((st) => {
                const list = byStep.get(st.id) ?? [];
                return (
                  <section
                    key={st.id}
                    data-col={st.id}
                    style={
                      {
                        '--accent': STEP_ACCENT_RGB[st.color] ?? '148 163 184',
                      } as React.CSSProperties
                    }
                    className="flex flex-col"
                    aria-label={t('board.columnAria', { column: t(`expenseSteps.${st.id}`) })}
                  >
                    <header className="flex items-center gap-2 px-1 pb-3">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${colorOf(st.color).dot}`}
                        aria-hidden="true"
                      />
                      <h2 className="font-display font-semibold text-sm">
                        {t(`expenseSteps.${st.id}`)}
                      </h2>
                      <span className="tnum font-display text-xs text-faint" data-count>
                        {list.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenNew()}
                        className="ml-auto w-7 h-7 rounded-lg text-faint hover:bg-surface2 hover:text-muted flex items-center justify-center"
                        aria-label={t('board.addToColumn', { column: t(`expenseSteps.${st.id}`) })}
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </header>
                    <div
                      data-list
                      className="flex-1 space-y-3 overflow-y-auto nice-scroll max-h-[calc(100vh-215px)] pr-1.5 pb-1"
                    >
                      {list.map((exp, i) => (
                        <ExpenseCard
                          key={exp.id}
                          expense={exp}
                          index={i}
                          onOpen={(id) => setDetailExpense({ id })}
                        />
                      ))}
                      {list.length === 0 && (
                        <p
                          data-empty
                          className="rounded-2xl border border-dashed border-app px-4 py-6 text-center text-sm text-muted"
                        >
                          {t('expenses.emptyColumn')}
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pb-4">
        <p className="text-sm text-muted">{t('expenses.openCount', { count: openCount })}</p>
      </div>

      {/* FAB móvil: nuevo gasto */}
      <button
        type="button"
        onClick={() => handleOpenNew()}
        className="lg:hidden fixed right-4 z-40 w-14 h-14 rounded-2xl bg-brand text-brandfg shadow-lg flex items-center justify-center hover:brightness-110"
        style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
        aria-label={t('expenses.new')}
      >
        <Plus className="w-6 h-6" aria-hidden="true" />
      </button>

      {creating && <ExpenseModal mode="create" onClose={() => setCreating(false)} />}
      {detailExpense && data.getExpense(detailExpense.id) && (
        <ExpenseDetailModal
          expense={data.getExpense(detailExpense.id)!}
          onClose={() => {
            data.releaseExpenseDetail(detailExpense.id);
            setDetailExpense(null);
          }}
          onDeleted={() => setDetailExpense(null)}
        />
      )}
    </div>
  );
}
