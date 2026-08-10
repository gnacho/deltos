import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { ExpenseStep } from '@/data/types';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { ExpenseCard, ExpenseCardMobile } from '@/components/ExpenseCard';
import { MobileMoveCard } from '@/components/MobileMoveCard';
import { ExpenseDetailModal } from '@/components/ExpenseDetailModal';
import { ExpenseModal } from '@/components/ExpenseModal';
import { BalanceStrip, ExpenseSummary } from '@/components/ExpenseSummary';
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

const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

type FilterType = 'all' | 'mine' | 'others';

export default function ExpenseBoard() {
  const { t } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const [creating, setCreating] = useState(false);
  const [detailExpense, setDetailExpense] = useState<{ id: string } | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [defaultStep, setDefaultStep] = useState<ExpenseStep>('nuevo');
  const [seg, setSeg] = useState<ExpenseStep>('nuevo');
  const [view, setView] = useState<'tablero' | 'resumen'>('tablero');

  const boardRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const placeholder = useRef<HTMLDivElement | null>(null);
  const flipRects = useRef<Map<string, DOMRect> | null>(null);

  const expenses = data.getExpenses();

  const visible = useMemo(() => {
    let list = expenses;
    if (filter === 'mine')
      list = list.filter((e) => e.created_by === me?.id || e.requested_user_id === me?.id);
    else if (filter === 'others')
      list = list.filter((e) => e.created_by !== me?.id && e.requested_user_id !== me?.id);
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

  /* FLIP: animar desde la posición anterior tras DnD */
  useLayoutEffect(() => {
    const before = flipRects.current;
    if (!before) return;
    flipRects.current = null;
    if (reducedMotionMQ.matches || !boardRef.current) return;
    boardRef.current.querySelectorAll<HTMLElement>('[data-task]').forEach((el) => {
      const old = before.get(el.dataset.task ?? '');
      if (!old) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px,${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform .28s ease';
        el.style.transform = '';
        el.addEventListener('transitionend', () => (el.style.transition = ''), { once: true });
      });
    });
  }, [expenses]);

  const handleOpenNew = (step: ExpenseStep) => {
    setDefaultStep(step);
    setCreating(true);
  };

  /* ---------- DnD (HTML5, delegado - copia exacta de BoardPage) ---------- */

  const cleanupDrag = () => {
    dragId.current = null;
    if (placeholder.current) {
      placeholder.current.remove();
      placeholder.current = null;
    }
    boardRef.current
      ?.querySelectorAll('.col-target')
      .forEach((s) => s.classList.remove('col-target'));
    boardRef.current?.querySelectorAll('.dragging').forEach((c) => {
      c.classList.remove('dragging');
      c.classList.add('card-dropped');
      c.addEventListener('animationend', () => c.classList.remove('card-dropped'), { once: true });
    });
    boardRef.current?.querySelectorAll<HTMLElement>('[data-empty]').forEach((p) => {
      p.style.display = '';
    });
  };

  const onDragStart = (e: DragEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-task]');
    if (!card) return;
    dragId.current = card.dataset.task ?? null;
    e.dataTransfer.setData('text/plain', dragId.current ?? '');
    e.dataTransfer.effectAllowed = 'move';
    const ph = document.createElement('div');
    ph.className = 'drop-placeholder';
    ph.style.height = `${card.offsetHeight}px`;
    ph.setAttribute('aria-hidden', 'true');
    placeholder.current = ph;
    window.setTimeout(() => card.classList.add('dragging'), 0);

    /* Ghost personalizado: clon opaco + sombra, no el semi-transparente del navegador */
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.classList.add('lift-ghost');
    ghost.style.width = `${card.offsetWidth}px`;
    ghost.style.position = 'fixed';
    ghost.style.top = '-9999px';
    ghost.style.left = '-9999px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, card.offsetWidth / 2, 20);
    window.setTimeout(() => ghost.remove(), 0);
  };

  const onDragOver = (e: DragEvent) => {
    if (!dragId.current) return;
    const section = (e.target as HTMLElement).closest<HTMLElement>('section[data-col]');
    if (!section) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    boardRef.current?.querySelectorAll('.col-target').forEach((s) => {
      if (s !== section) s.classList.remove('col-target');
    });
    section.classList.add('col-target');
    const list = section.querySelector('[data-list]');
    if (!list || !placeholder.current) return;
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-task]')).filter(
      (c) => c.dataset.task !== dragId.current,
    );
    let ref: HTMLElement | null = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        ref = c;
        break;
      }
    }
    const empty = list.querySelector<HTMLElement>('[data-empty]');
    if (empty) empty.style.display = 'none';
    if (ref) list.insertBefore(placeholder.current, ref);
    else list.appendChild(placeholder.current);
  };

  const onDrop = (e: DragEvent) => {
    if (!dragId.current) return;
    e.preventDefault();
    const section = (e.target as HTMLElement).closest<HTMLElement>('section[data-col]');
    if (!section) {
      cleanupDrag();
      return;
    }
    let refId: string | null = null;
    if (placeholder.current?.parentElement) {
      let n = placeholder.current.nextElementSibling as HTMLElement | null;
      while (n) {
        if (n.dataset?.task) {
          refId = n.dataset.task;
          break;
        }
        n = n.nextElementSibling as HTMLElement | null;
      }
    }
    const id = dragId.current;
    const toCol = section.dataset.col as ExpenseStep;
    cleanupDrag();
    void doMove(id, toCol, refId);
  };

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

    if (!reducedMotionMQ.matches && boardRef.current) {
      const map = new Map<string, DOMRect>();
      boardRef.current.querySelectorAll<HTMLElement>('[data-task]').forEach((el) => {
        map.set(el.dataset.task ?? '', el.getBoundingClientRect());
      });
      flipRects.current = map;
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

  const doMoveMobile = (id: string, toStep: string) => {
    const expense = data.getExpense(id);
    if (!expense || expense.step === toStep) return;
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
    <div className="pt-[52px] lg:pt-0">
      {/* ============ SEGMENTED CONTROL MÓVIL ============ */}
      <div
        className="lg:hidden fixed top-14 inset-x-0 z-30 border-b border-app px-4 py-2.5"
        style={{ backgroundColor: 'var(--bg)' }}
      >
        <div
          role="tablist"
          data-segbar
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

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7">
        {/* Cabecera de vista */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="font-display font-bold text-2xl lg:text-[28px] tracking-tight">
              {t('expenses.title')}
            </h1>
            <p className="text-sm text-muted mt-0.5">{t('expenses.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <p className="tnum text-sm text-muted">
              {t('expenses.openCount', { count: openCount })}
            </p>
          </div>
        </div>

        {/* Vista: Tablero | Resumen + Alcance */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label={t('expenses.viewAria')}
            className="inline-flex items-center gap-1 rounded-full bg-surface2 p-1"
          >
            {(['tablero', 'resumen'] as const).map((v) => {
              const active = view === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setView(v)}
                  className={`rounded-full px-3.5 h-9 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    active ? 'bg-surface shadow-soft text-text' : 'text-muted hover:text-text'
                  }`}
                >
                  {t(v === 'tablero' ? 'expenses.board' : 'expenses.summary')}
                </button>
              );
            })}
          </div>
        </div>

        {view === 'resumen' ? (
          <div className="pb-8">
            <ExpenseSummary expenses={expenses} />
          </div>
        ) : (
          <>
            <BalanceStrip expenses={expenses} />

            {/* Alcance: Todas / Mías / De otras */}
            <div className="mb-5">
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
            </div>

            {/* Lista móvil (<lg): un solo estado */}
            <div
              className="lg:hidden space-y-3 pb-4"
              aria-live="polite"
              aria-label={t('board.listAria')}
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
                  {t('board.emptyState', { column: t(`expenseSteps.${seg}`) })}
                </p>
              )}
            </div>

            {/* Tablero escritorio (lg+): kanban 3 columnas con drag & drop */}
            <div
              ref={boardRef}
              className="hidden lg:grid lg:grid-cols-3 lg:items-start gap-4"
              aria-live="polite"
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={cleanupDrag}
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
                        onClick={() => handleOpenNew(st.id)}
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
                          {t('board.emptyColumn')}
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

      {/* FAB móvil: nuevo gasto */}
      <button
        type="button"
        onClick={() => handleOpenNew(seg)}
        className="lg:hidden fixed right-4 z-40 w-14 h-14 rounded-2xl bg-brand text-brandfg shadow-lg flex items-center justify-center hover:brightness-110"
        style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
        aria-label={t('expenses.new')}
      >
        <Plus className="w-6 h-6" aria-hidden="true" />
      </button>

      {creating && (
        <ExpenseModal
          mode="create"
          defaultStep={defaultStep}
          onClose={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      )}
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
