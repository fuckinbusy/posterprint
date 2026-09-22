/* Перевод заказа в другой статус.

   Перетаскивание карточки и стрелка «дальше» меняют колонку одним случайным
   движением мыши, поэтому там всегда спрашивается подтверждение. Смена
   статуса из карточки заказа уже требует открыть заказ и осознанно нажать
   нужный статус — лишний шаг там ни к чему, и confirm можно выключить. */

import { useCallback } from 'react';

import { useSetOrderStatus } from '@/api/orders';
import { useConfirm } from '@/app/ConfirmProvider';
import { useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import type { Order, OrderStatus } from '@/types/api';

import { CancelOrderModal } from './CancelOrderModal';
import { useStatuses } from './useStatuses';

export function useMoveStatus() {
  const { toast, toastError } = useToast();
  const askConfirm = useConfirm();
  const modal = useModal();
  const statuses = useStatuses();
  const mutation = useSetOrderStatus();

  return useCallback(
    async (order: Order, target: OrderStatus, options: { confirm?: boolean } = {}) => {
      if (order.status === target) return;

      if (!statuses.allowedFrom(order.status).includes(target)) {
        toast(
          `Нельзя перевести из «${statuses.title(order.status)}» в «${statuses.title(target)}»`,
        );
        return;
      }

      const apply = async (reason = '') => {
        try {
          const updated = await mutation.mutateAsync({ id: order.id, status: target, reason });
          toast(`${updated.number} → ${statuses.title(target)}`);
        } catch (e) {
          toastError(e);
        }
      };

      /* У отмены свой разговор: вместо «вы уверены?» спрашиваем почему.
       * Подтверждением служит сама кнопка «Отменить заказ» в этом окне,
       * поэтому обычное confirm тут не нужно даже при перетаскивании. */
      if (target === 'cancelled') {
        modal.push(<CancelOrderModal order={order} onConfirm={(reason) => void apply(reason)} />, {
          backLabel: '← Назад',
        });
        return;
      }

      if (options.confirm !== false) {
        const ok = await askConfirm({
          eyebrow: order.number,
          title: 'Сменить статус?',
          text: [
            <>
              Заказ <b>{order.number}</b> — {order.title}
            </>,
            <>
              <span style={{ color: statuses.color(order.status) }}>
                {statuses.title(order.status)}
              </span>
              {' → '}
              <span style={{ color: statuses.color(target) }}>{statuses.title(target)}</span>
            </>,
          ],
          yes: 'Перевести',
          no: 'Отмена',
        });
        if (!ok) return;
      }

      await apply();
    },
    [askConfirm, modal, mutation, statuses, toast, toastError],
  );
}
