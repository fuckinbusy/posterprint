/* Открыть карточку заказа.

   Вынесено в хук, потому что заказ открывается из полудюжины мест: с доски,
   из контекстного меню, из истории клиента, из другого заказа. Каждое из них
   должно попадать в один и тот же экран. */

import { useCallback } from 'react';

import { useModal } from '@/app/ModalProvider';

import { OrderCardModal } from './OrderCardModal';

export function useOpenOrder() {
  const modal = useModal();

  return useCallback(
    (orderId: number, options: { push?: boolean; backLabel?: string } = {}) => {
      const content = <OrderCardModal orderId={orderId} />;
      if (options.push) modal.push(content, { backLabel: options.backLabel ?? '← Назад' });
      else modal.open(content);
    },
    [modal],
  );
}
