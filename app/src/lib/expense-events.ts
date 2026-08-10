import type { TFunction } from 'i18next';
import { fmtMoney } from '@/lib/format';

const STEP_I18N: Record<string, string> = {
  nuevo: 'expenseSteps.nuevo',
  'en-curso': 'expenseSteps.en-curso',
  hecho: 'expenseSteps.hecho',
};

const METHOD_I18N: Record<string, string> = {
  bizum: 'expenses.bizum',
  transfer: 'expenses.transfer',
  efectivo: 'expenses.efectivo',
};

/**
 * Traduce un evento de actividad de gasto a texto natural en el idioma del usuario.
 * Devuelve { actor, text } listo para renderizar "actor text".
 */
export function formatExpenseEvent(
  ev: { type: string; data: string | Record<string, unknown> },
  t: TFunction,
  locale: string,
): string {
  const data = typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : ev.data || {};

  switch (ev.type) {
    case 'created':
      return t('expenseEvents.created');
    case 'title':
      if (data.from && data.to)
        return t('expenseEvents.titleChanged', { from: data.from, to: data.to });
      return t('expenseEvents.titleEdited');
    case 'amount': {
      const from = typeof data.from === 'number' ? fmtMoney(data.from, locale) : '';
      const to = typeof data.to === 'number' ? fmtMoney(data.to, locale) : '';
      if (from && to) return t('expenseEvents.amountChanged', { from, to });
      if (to) return t('expenseEvents.amountTo', { amount: to });
      return t('expenseEvents.amountEdited');
    }
    case 'notes':
      return t('expenseEvents.notesEdited');
    case 'shares': {
      const count = typeof data.count === 'number' ? data.count : 0;
      return t('expenseEvents.sharesUpdated', { count });
    }
    case 'payer':
      return t('expenseEvents.payerChanged');
    case 'payment_method': {
      const method = (data.to || data.method || '') as string;
      const label = method ? t(METHOD_I18N[method] || method) : '';
      return label ? t('expenseEvents.paymentMethodTo', { method: label }) : t('expenseEvents.paymentMethodEdited');
    }
    case 'moved': {
      const from = data.from ? t(STEP_I18N[data.from as string] || String(data.from)) : '';
      const to = data.to ? t(STEP_I18N[data.to as string] || String(data.to)) : '';
      if (from && to) return t('expenseEvents.moved', { from, to });
      if (to) return t('expenseEvents.movedTo', { to });
      return t('expenseEvents.stepChanged');
    }
    case 'paid':
      return t('expenseEvents.paidShare');
    case 'settled':
      return t('expenseEvents.settled');
    case 'attachment': {
      const filename = (data.filename as string) || '';
      return filename ? t('expenseEvents.attachmentAdded', { filename }) : t('expenseEvents.attachmentAddedGeneric');
    }
    default:
      return ev.type;
  }
}
