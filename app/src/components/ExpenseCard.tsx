import { MessageCircle, Paperclip, Check, Archive, ArchiveRestore } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Expense } from '@/data/types';
import { Avatar } from '@/components/Avatar';
import { TagChip, UnassignedAvatar } from '@/components/badges';
import { fmtMoney } from '@/lib/format';

interface CardProps {
  expense: Expense;
  index: number;
  onOpen: (id: string) => void;
  /** Gasto archivado: sin drag, con acción de desarchivar. */
  archived?: boolean;
  /** Archivado manual (solo gastos en Pagado). */
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
}

/* Mismos pares claro/oscuro que PRIORITY_BADGE (lib/constants). */
const BADGE_OK = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
const BADGE_PENDING = 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';

function SharesBadge({ expense, big }: { expense: Expense; big?: boolean }) {
  const { t } = useTranslation();
  if (!expense.shares?.length) return null;
  const pending = expense.shares.filter((sh) => !sh.paid).length;
  const allPaid = pending === 0;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${big ? 'text-[12px]' : 'text-[11px]'} ${
        allPaid ? BADGE_OK : BADGE_PENDING
      }`}
    >
      {allPaid
        ? t('expenses.sharesSettled', { count: expense.shares.length })
        : t('expenses.sharesPending', { count: pending })}
      {allPaid && <Check className="w-3 h-3" aria-hidden="true" />}
    </span>
  );
}

/** Tarjeta desktop (completa): categoría, importe, badges de pago, contadores, avatar.
 *  Div role=button (no <button>) para anidar archivar/desarchivar sin elementos
 *  interactivos anidados inválidos. */
export function ExpenseCard({ expense, index, onOpen, archived, onArchive, onUnarchive }: CardProps) {
  const { t, i18n } = useTranslation();
  const done = expense.step === 'hecho';
  const delay = Math.min(index, 10) * 40;
  const canArchive = !archived && done && onArchive !== undefined;
  const label = expense.label_id
    ? {
        id: expense.label_id,
        name: expense.label_name ?? '',
        color: expense.label_color ?? 'slate',
      }
    : null;
  return (
    <div
      role="button"
      tabIndex={0}
      data-task={archived ? undefined : expense.id}
      data-archived={archived ? expense.id : undefined}
      draggable={!archived}
      onClick={() => onOpen(expense.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(expense.id);
        }
      }}
      style={{ animationDelay: `${delay}ms` }}
      className={`card w-full text-left rounded-2xl bg-surface border border-app shadow-soft p-3.5 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand ${
        done ? 'opacity-60' : ''
      } ${archived ? 'opacity-50 bg-surface2/60' : ''}`}
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
      {(expense.shares?.length > 0 || expense.payment_method) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <SharesBadge expense={expense} />
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
        <span className="flex items-center gap-2">
          {canArchive && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(expense.id);
              }}
              className="w-7 h-7 -mr-1 rounded-lg text-faint hover:bg-surface2 hover:text-muted flex items-center justify-center"
              aria-label={t('expenses.archiveAria', { title: expense.title })}
              title={t('expenses.archive')}
            >
              <Archive className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {archived && onUnarchive && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUnarchive(expense.id);
              }}
              className="w-7 h-7 -mr-1 rounded-lg text-faint hover:bg-surface2 hover:text-muted flex items-center justify-center"
              aria-label={t('expenses.unarchiveAria', { title: expense.title })}
              title={t('expenses.unarchive')}
            >
              <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {expense.payer_username ? (
            <Avatar name={expense.payer_username} color={expense.payer_color} />
          ) : (
            <UnassignedAvatar />
          )}
        </span>
      </div>
    </div>
  );
}

/** Tarjeta MÓVIL simplificada: título (17px/600, 2 líneas), importe y estado del split. */
export function ExpenseCardMobile({ expense, index, onOpen, archived, onUnarchive }: CardProps) {
  const { t, i18n } = useTranslation();
  const done = expense.step === 'hecho';
  const delay = Math.min(index, 10) * 40;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpen(expense.id)}
        style={{ animationDelay: `${delay}ms` }}
        className={`card w-full text-left rounded-2xl bg-surface border border-app shadow-soft px-4 py-3.5 min-h-[64px] flex flex-col justify-center gap-2 ${
          done ? 'opacity-60' : ''
        } ${archived ? 'opacity-50 bg-surface2/60' : ''}`}
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
          <SharesBadge expense={expense} big />
        </div>
      </button>

      {/* Archivado (móvil): acción de desarchivar bajo la tarjeta */}
      {archived && onUnarchive && (
        <button
          type="button"
          onClick={() => onUnarchive(expense.id)}
          className="mt-1 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-app bg-surface px-3 py-2 text-[13px] font-medium text-muted hover:text-text"
        >
          <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
          {t('expenses.unarchive')}
        </button>
      )}
    </div>
  );
}
