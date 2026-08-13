/* Удаление заказа с подтверждением.

   Удаление безвозвратно и уносит историю, поэтому спрашиваем всегда и
   отдельно подсказываем более мягкий путь — статус «Отменён». */

import { useCallback } from 'react';

import { useDeleteOrder } from '@/api/orders';
import { useConfirm } from '@/app/ConfirmProvider';
import { useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import type { Order } from '@/types/api';

export function useDeleteOrderFlow() {
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();
  const modal = useModal();
  const mutation = useDeleteOrder();

  return useCallback(
    async (order: Order) => {
      const ok = await askConfirm({
        eyebrow: 'Удаление',
        title: 'Удалить заказ?',
        text: (
          <>
            Заказ <b>{order.number}</b> — {order.title} будет удалён вместе с историей. Отменить это
            нельзя.
          </>
        ),
        note: 'Если заказ просто не состоялся, переведите его в «Отменён» — он останется в базе.',
        yes: 'Удалить заказ',
        danger: true,
      });
      if (!ok) return;

      try {
        await mutation.mutateAsync(order.id);
        toast(`${order.number} удалён`);
        modal.closeAll();
      } catch (e) {
        toastError(e);
      }
    },
    [askConfirm, modal, mutation, toast, toastError],
  );
}
