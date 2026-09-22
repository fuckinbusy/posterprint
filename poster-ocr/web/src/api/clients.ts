/* Справочник клиентов: список, карточка, история заказов, подсказки в форме. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from './client';
import { qk, type ClientsFilter } from './keys';
import type {
  Client,
  ClientOrderRow,
  ClientUpdatePayload,
  ClientsSummary,
  Paged,
} from '@/types/api';

export const CLIENTS_PAGE = 25;
export const CLIENT_ORDERS_PAGE = 10;

/* ---------------------------------------------------- чтение */
export function fetchClients(filter: ClientsFilter): Promise<Paged<Client>> {
  const params = new URLSearchParams({
    limit: String(CLIENTS_PAGE),
    offset: String(filter.offset),
  });
  // поиск и сортировка на сервере взаимоисключающи: при запросе q
  // порядок задаёт релевантность
  if (filter.q) params.set('q', filter.q);
  else params.set('sort', filter.sort);
  return request<Paged<Client>>(`/clients?${params}`);
}

export const fetchClientsSummary = (): Promise<ClientsSummary> =>
  request<ClientsSummary>('/clients/summary');

export const fetchClient = (id: number): Promise<Client> => request<Client>(`/clients/${id}`);

export const fetchClientOrders = (id: number, offset: number): Promise<Paged<ClientOrderRow>> =>
  request<Paged<ClientOrderRow>>(
    `/clients/${id}/orders?limit=${CLIENT_ORDERS_PAGE}&offset=${offset}`,
  );

/** Подсказки при заполнении заказа.
 *
 * Ответ постраничный — {items, total, ...}, а не голый массив. Прежний фронт
 * этого не учитывал и подставлял в список весь объект, поэтому подсказки
 * всегда показывали «ничего не нашлось». */
export async function searchClients(q: string): Promise<Client[]> {
  const page = await request<Paged<Client>>(`/clients?q=${encodeURIComponent(q)}&limit=6`);
  return page.items;
}

/* ---------------------------------------------------- хуки */
export function useClients(filter: ClientsFilter, enabled = true) {
  return useQuery({
    queryKey: qk.clients(filter),
    queryFn: () => fetchClients(filter),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useClientsSummary(enabled = true) {
  return useQuery({
    queryKey: qk.clientsSummary,
    queryFn: fetchClientsSummary,
    enabled,
    // сводка не критична: если права не дали — просто не показываем строку
    retry: false,
  });
}

export function useClient(id: number | null) {
  return useQuery({
    queryKey: qk.client(id ?? 0),
    queryFn: () => fetchClient(id as number),
    enabled: id !== null,
  });
}

export function useClientOrders(id: number | null, offset: number, enabled = true) {
  return useQuery({
    queryKey: qk.clientOrders(id ?? 0, offset),
    queryFn: () => fetchClientOrders(id as number, offset),
    enabled: id !== null && enabled,
    placeholderData: (previous) => previous,
  });
}

export function useClientSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.clientSearch(q),
    queryFn: () => searchClients(q),
    // меньше двух символов — запрос бессмысленный, найдётся пол-базы
    enabled: enabled && q.trim().length >= 2,
    staleTime: 30 * 1000,
  });
}

/* ---------------------------------------------------- изменение */
export const updateClient = (id: number, payload: ClientUpdatePayload): Promise<Client> =>
  request<Client>(`/clients/${id}`, { method: 'PATCH', body: payload });

export const deleteClient = (id: number): Promise<null> =>
  request<null>(`/clients/${id}`, { method: 'DELETE' });

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ClientUpdatePayload }) =>
      updateClient(id, payload),
    onSuccess: (client) => {
      qc.setQueryData(qk.client(client.id), client);
      qc.invalidateQueries({ queryKey: qk.clientsAll });
      // в заказах хранится снимок имени и телефона — сервер их не трогает,
      // но список заказов показывает client_name, поэтому перечитываем
      qc.invalidateQueries({ queryKey: qk.ordersAll });
    },
  });
}

export const mergeClient = (id: number, into: number): Promise<Client> =>
  request<Client>(`/clients/${id}/merge`, { method: 'POST', body: { into } });

/** Слияние двух карточек: заказы уезжают в целевую, исходная удаляется. */
export function useMergeClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, into }: { id: number; into: number }) => mergeClient(id, into),
    onSuccess: (client) => {
      qc.setQueryData(qk.client(client.id), client);
      qc.invalidateQueries({ queryKey: qk.clientsAll });
      qc.invalidateQueries({ queryKey: qk.ordersAll });
    },
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteClient,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clientsAll });
      qc.invalidateQueries({ queryKey: qk.ordersAll });
    },
  });
}
