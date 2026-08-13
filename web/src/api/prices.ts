/* Прайс: разделы и позиции.

   Правка цены влияет на расчёт в форме заказа, поэтому после любой мутации
   сбрасывается ещё и каталог: варианты полей-списков берутся из прайса. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from './client';
import { qk } from './keys';
import type {
  PriceGroupPayload,
  PriceItem,
  PriceItemCreatePayload,
  PriceItemUpdatePayload,
  PricesResponse,
} from '@/types/api';

export const fetchPrices = (): Promise<PricesResponse> => request<PricesResponse>('/prices');

export function usePrices(enabled = true) {
  return useQuery({
    queryKey: qk.prices,
    queryFn: fetchPrices,
    enabled,
  });
}

/* ---------------------------------------------------- разделы */
export const createPriceGroup = (
  payload: PriceGroupPayload,
): Promise<{ id: number; key: string; title: string }> =>
  request('/prices/groups', { method: 'POST', body: payload });

export const updatePriceGroup = (
  id: number,
  payload: PriceGroupPayload,
): Promise<{ id: number; key: string; title: string }> =>
  request(`/prices/groups/${id}`, { method: 'PATCH', body: payload });

export const deletePriceGroup = (id: number): Promise<null> =>
  request<null>(`/prices/groups/${id}`, { method: 'DELETE' });

/* ---------------------------------------------------- позиции */
export const createPriceItem = (payload: PriceItemCreatePayload): Promise<PriceItem> =>
  request<PriceItem>('/prices', { method: 'POST', body: payload });

export const updatePriceItem = (id: number, payload: PriceItemUpdatePayload): Promise<PriceItem> =>
  request<PriceItem>(`/prices/${id}`, { method: 'PATCH', body: payload });

export const deletePriceItem = (id: number): Promise<null> =>
  request<null>(`/prices/${id}`, { method: 'DELETE' });

/** Перенос в другой раздел. Поля видов работ, которые ссылались на позицию
 *  поимённо, сервер переключает следом — вручную это забывалось. */
export const movePriceItem = (id: number, groupKey: string): Promise<PriceItem> =>
  request<PriceItem>(`/prices/${id}/move`, { method: 'POST', body: { group_key: groupKey } });

export const restoreDefaults = (): Promise<{ added: number }> =>
  request('/prices/restore-defaults', { method: 'POST' });

/* ---------------------------------------------------- сброс кэша */
/** Прайс задаёт варианты полей в форме заказа — каталог тоже устаревает. */
export function usePricesInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.prices });
    qc.invalidateQueries({ queryKey: qk.catalog });
  };
}

export function usePriceMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const invalidate = usePricesInvalidation();
  return useMutation({
    mutationFn: fn,
    onSuccess: invalidate,
  });
}
