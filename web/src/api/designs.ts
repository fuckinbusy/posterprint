/* Макеты заказов: сведения о файле, превью, загрузка, скачивание, удаление. */

import { useQuery } from '@tanstack/react-query';

import { request, requestBlob } from './client';
import { qk } from './keys';
import type { DesignInfo, DesignLink } from '@/types/api';

/** Максимум, который принимает сервер. Проверяем и здесь: незачем гнать
 *  по сети 400 МБ, чтобы получить отказ. */
export const MAX_DESIGN_BYTES = 300 * 1024 * 1024;

export const fetchDesignInfo = (orderId: number): Promise<DesignInfo> =>
  request<DesignInfo>(`/orders/${orderId}/design`);

export const fetchDesignPreview = (orderId: number): Promise<Blob | null> =>
  requestBlob(`/orders/${orderId}/design/preview`);

export const fetchDesignLink = (orderId: number): Promise<DesignLink> =>
  request<DesignLink>(`/orders/${orderId}/design/link`);

export function uploadDesign(orderId: number, file: File): Promise<DesignInfo> {
  const form = new FormData();
  form.append('file', file);
  return request<DesignInfo>(`/orders/${orderId}/design`, { method: 'POST', body: form });
}

export const deleteDesign = (orderId: number): Promise<null> =>
  request<null>(`/orders/${orderId}/design`, { method: 'DELETE' });

export function useDesignInfo(orderId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.design(orderId ?? 0),
    queryFn: () => fetchDesignInfo(orderId as number),
    enabled: orderId !== null && enabled,
  });
}
