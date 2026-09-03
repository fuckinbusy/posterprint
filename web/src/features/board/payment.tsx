/* Метка оплаты на карточке заказа. */

import { money } from '@/lib/format';
import type { Order, PaymentState } from '@/types/api';

const LABELS: Record<PaymentState, string> = {
  paid: 'Оплачен',
  partial: 'Частично',
  none: 'Не оплачен',
  refunded: 'Возврат',
  overpaid: 'Переплата',
  unset: '',
  hidden: '',
};

export const paymentLabel = (state: PaymentState): string => LABELS[state] ?? '';

export function PayBadge({ order }: { order: Order }) {
  const label = paymentLabel(order.payment);
  if (!label) return null;

  let hint = '';
  if (order.payment === 'partial' && order.debt) hint = ` — остаток ${money(order.debt)}`;
  if (order.payment === 'overpaid' && order.surplus) hint = ` — лишние ${money(order.surplus)}`;
  if (order.payment === 'refunded' && order.prepaid) hint = ` — вернули ${money(order.prepaid)}`;

  return (
    <span className={`pay pay-${order.payment}`} title={label + hint}>
      <i />
      {label}
    </span>
  );
}
