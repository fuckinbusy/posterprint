/* Открыть форму заказа — новую или на правку существующего. */

import { useCallback } from 'react';

import { useModal } from '@/app/ModalProvider';
import type { Order } from '@/types/api';

import { OrderFormModal } from './OrderFormModal';

export function useOpenOrderForm() {
  const modal = useModal();

  return useCallback(
    (order: Order) => modal.replace(<OrderFormModal templateKey={order.template_key} order={order} />),
    [modal],
  );
}

/** Форма создания по выбранному виду работ. */
export function useOpenNewOrderForm() {
  const modal = useModal();
  return useCallback(
    (templateKey: string) => modal.replace(<OrderFormModal templateKey={templateKey} order={null} />),
    [modal],
  );
}
