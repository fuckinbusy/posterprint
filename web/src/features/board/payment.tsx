/* Метка оплаты на карточке заказа. */

import { money } from '@/lib/format';
import type { Order, PaymentState } from '@/types/api';

const LABELS: Record<PaymentState, string> = {
  paid: 'Оплачен',
  partial: 'Частично',
  none: 'Не оплачен',
  refunded: 'Возврат',
  unset: '',
  hidden: '',
};

export const paymentLabel = (state: PaymentState): string => LABELS[state] ?? '';

export function PayBadge({ order }: { order: Order }) {
  const label = paymentLabel(order.payment);
  if (!label) return null;

  const hint =
    order.payment === 'partial' && order.debt ? ` — остаток ${money(order.debt)}` : '';

  return (
    <span className={`pay pay-${order.payment}`} title={label + hint}>
      <i />
      {label}
    </span>
  );
}
