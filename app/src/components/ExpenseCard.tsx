import { MessageCircle, Paperclip, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Expense } from '@/data/types';
import { Avatar } from '@/components/Avatar';
import { TagChip, UnassignedAvatar } from '@/components/badges';
import { fmtMoney } from '@/lib/format';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { announce } from '@/lib/announce';

interface CardProps {
  expense: Expense;
  index: number;
  onOpen: (id: string) => void;
}

/* Mismos pares claro/oscuro que PRIORITY_BADGE (lib/constants). */
const BADGE_OK = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
const BADGE_PENDING = 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';

function SplitBadge({ expense, big, onSettle }: { expense: Expense; big?: boolean; onSettle?: () => void }) {
  const { t, i18n } = useTranslation();
  if (!expense.requested_user_id) return null;
  const label =
    expense.split_type === 'half'
      ? t('expenses.splitHalf')
      : expense.split_type === 'custom'
        ? fmtMoney(expense.split_amount_cents ?? 0, i18n.language)
        : t('expenses.splitFull');
  const cls = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${big ? 'text-[12px]' : 'text-[11px]'} ${
    expense.paid_by_requested ? BADGE_OK : BADGE_PENDING
  }`;
  const content = (
    <>
      {label} → {expense.requested_username}
      {expense.paid_by_requested && <Check className="w-3 h-3" aria-hidden="true" />}
    </>
  );
  if (onSettle) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSettle(); }}
        className={`${cls} cursor-pointer hover:brightness-95`}
        title={t('expenses.settle')}
      >
        {content}
      </button>
    );
  }
  return <span className={cls}>{content}</span>;
}

/** Tarjeta desktop (completa): categoría, importe, badges de pago, contadores, avatar. */
export function ExpenseCard({ expense, index, onOpen }: CardProps) {
  const { t, i18n } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const done = expense.step === 'hecho';
  const delay = Math.min(index, 10) * 40;

  const canSettle = expense.requested_user_id === me?.id && !expense.paid_by_requested;
  const handleSettle = async () => {
    try {
      await data.updateExpense(expense.id, { paid_by_requested: true });
      announce(t('expenses.settleDone', { count: 1 }));
    } catch {
      announce(t('common.error'));
    }
  };
  const label = expense.label_id
    ? {
        id: expense.label_id,
        name: expense.label_name ?? '',
        color: expense.label_color ?? 'slate',
      }
    : null;
  return (
    <button
      type="button"
      data-task={expense.id}
      draggable
      onClick={() => onOpen(expense.id)}
      style={{ animationDelay: `${delay}ms` }}
      className={`card w-full text-left rounded-2xl bg-surface border border-app shadow-soft p-3.5 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md ${done ? 'opacity-60' : ''}`}
    >
      {label && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <TagChip label={label} />
        </div>
      )}
      <h3
        className={`text-[15px] font-medium leading-snug ${done ? 'line-through decoration-1' : ''}`}
      >
        {expense.title}
      </h3>
      <p className="tnum text-[17px] font-semibold mt-0.5">
        {fmtMoney(expense.amount_cents, i18n.language)}
      </p>
      {(expense.paid_by_creator || expense.requested_user_id || expense.payment_method) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {expense.paid_by_creator ? (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${BADGE_OK}`}>
              {t('expenses.paid')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface2 text-muted border border-app">
              {t('expenses.notPaid')}
            </span>
          )}
          <SplitBadge expense={expense} onSettle={canSettle ? handleSettle : undefined} />
          {expense.payment_method && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface2 text-muted">
              {t(`expenses.${expense.payment_method}`)}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-app">
        <span className="tnum flex items-center gap-3 text-xs text-faint">
          {expense.counts.comments > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
              {expense.counts.comments}
            </span>
          )}
          {expense.counts.attachments > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
              {expense.counts.attachments}
            </span>
          )}
        </span>
        {expense.created_by_username ? (
          <Avatar name={expense.created_by_username} color={expense.created_by_color} />
        ) : (
          <UnassignedAvatar />
        )}
      </div>
    </button>
  );
}

/** Tarjeta MÓVIL simplificada: título (17px/600, 2 líneas), importe y estado del split. */
export function ExpenseCardMobile({ expense, index, onOpen }: CardProps) {
  const { t, i18n } = useTranslation();
  const data = useData();
  const { user: me } = useSession();
  const done = expense.step === 'hecho';
  const delay = Math.min(index, 10) * 40;

  const canSettle = expense.requested_user_id === me?.id && !expense.paid_by_requested;
  const handleSettle = async () => {
    try {
      await data.updateExpense(expense.id, { paid_by_requested: true });
      announce(t('expenses.settleDone', { count: 1 }));
    } catch {
      announce(t('common.error'));
    }
  };
  return (
    <button
      type="button"
      onClick={() => onOpen(expense.id)}
      style={{ animationDelay: `${delay}ms` }}
      className={`card w-full text-left rounded-2xl bg-surface border border-app shadow-soft px-4 py-3.5 min-h-[64px] flex flex-col justify-center gap-2 ${done ? 'opacity-60' : ''}`}
    >
      <h3
        className={`text-[17px] font-semibold leading-snug line-clamp-2 ${done ? 'line-through decoration-1' : ''}`}
      >
        {expense.title}
      </h3>
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        <span className="tnum text-[13px] font-semibold">
          {fmtMoney(expense.amount_cents, i18n.language)}
        </span>
        <SplitBadge expense={expense} big onSettle={canSettle ? handleSettle : undefined} />
      </div>
    </button>
  );
}
