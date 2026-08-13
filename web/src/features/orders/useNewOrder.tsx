/* Кнопка «Новый заказ»: сначала выбор вида работ, потом форма. */

import { useCallback } from 'react';

import { useModal } from '@/app/ModalProvider';

import { TemplatePickerModal } from './TemplatePickerModal';

export function useNewOrder() {
  const modal = useModal();
  return useCallback(() => modal.open(<TemplatePickerModal />), [modal]);
}
