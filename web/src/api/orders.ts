/* Заказы: список доски, карточка, создание, правка, статус, удаление, расчёт. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useBoardRefresh } from '@/app/prefs';

import { request } from './client';
import { qk, type OrdersFilter } from './keys';
import type {
  Estimate,
  Order,
  OrderCreatePayload,
  OrderExtraIn,
  OrderParams,
  OrderPayment,
  OrderStatus,
  OrderUpdatePayload,
} from '@/types/api';

/* ---------------------------------------------------- чтение */
export function fetchOrders(filter: OrdersFilter): Promise<Order[]> {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.templateKey !== 'all') params.set('template_key', filter.templateKey);
  const suffix = params.toString() ? `?${params}` : '';
  return request<Order[]>(`/orders${suffix}`);
}

export const fetchOrder = (id: number): Promise<Order> => request<Order>(`/orders/${id}`);

export function useOrders(filter: OrdersFilter, enabled = true) {
  // автообновление — личная настройка рабочего места (страница профиля):
  // планшету в цехе нужно, чтобы новые заказы появлялись сами
  const refresh = useBoardRefresh();
  return useQuery({
    queryKey: qk.orders(filter),
    queryFn: () => fetchOrders(filter),
    enabled,
    refetchInterval: refresh > 0 ? refresh * 1000 : false,
    // в свёрнутой вкладке не опрашиваем: это трафик впустую
    refetchIntervalInBackground: false,
    // при поиске держим прежний список на экране, пока едет новый:
    // иначе доска мигает пустотой на каждую набранную букву
    placeholderData: (previous) => previous,
  });
}

export function useOrder(id: number | null) {
  return useQuery({
    queryKey: qk.order(id ?? 0),
    queryFn: () => fetchOrder(id as number),
    enabled: id !== null,
  });
}

/** QR и реквизиты для оплаты. Сумму считает сервер (по умолчанию — остаток),
 *  но её можно задать: предоплату берут не всегда ровно половиной. */
export const fetchOrderPayment = (orderId: number, amount: number): Promise<OrderPayment> =>
  request<OrderPayment>(`/orders/${orderId}/payment?amount=${encodeURIComponent(amount)}`);

export function useOrderPayment(orderId: number, amount: number, enabled = true) {
  return useQuery({
    queryKey: qk.payment(orderId, amount),
    queryFn: () => fetchOrderPayment(orderId, amount),
    enabled,
    // реквизиты меняются раз в год: перезапрашивать их при каждом
    // возврате к вкладке незачем
    staleTime: 10 * 60 * 1000,
  });
}

/* ---------------------------------------------------- изменение */
export const createOrder = (payload: OrderCreatePayload): Promise<Order> =>
  request<Order>('/orders', { method: 'POST', body: payload });

export const updateOrder = (id: number, payload: OrderUpdatePayload): Promise<Order> =>
  request<Order>(`/orders/${id}`, { method: 'PATCH', body: payload });

/** reason заполняется только при отмене — остальные переходы его игнорируют. */
export const setOrderStatus = (id: number, status: OrderStatus, reason = ''): Promise<Order> =>
  request<Order>(`/orders/${id}/status`, { method: 'POST', body: { status, reason } });

export const deleteOrder = (id: number): Promise<null> =>
  request<null>(`/orders/${id}`, { method: 'DELETE' });

export const estimatePrice = (
  templateKey: string,
  quantity: number,
  params: OrderParams,
  extras: OrderExtraIn[] = [],
): Promise<Estimate> =>
  request<Estimate>('/price/estimate', {
    method: 'POST',
    body: { template_key: templateKey, quantity, params, extras },
  });

/* ---------------------------------------------------- хуки мутаций */
/** Общий сброс после любой правки заказа: доска и открытая карточка. */
function useOrderInvalidation() {
  const qc = useQueryClient();
  return (order?: Order) => {
    qc.invalidateQueries({ queryKey: qk.ordersAll });
    if (order) qc.setQueryData(qk.order(order.id), order);
    // счётчики клиента (сколько заказов, на какую сумму) тоже поехали
    qc.invalidateQueries({ queryKey: qk.clientsAll });
  };
}

export function useCreateOrder() {
  const invalidate = useOrderInvalidation();
  return useMutation({
    mutationFn: createOrder,
    onSuccess: invalidate,
  });
}

export function useUpdateOrder() {
  const invalidate = useOrderInvalidation();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: OrderUpdatePayload }) =>
      updateOrder(id, payload),
    onSuccess: invalidate,
  });
}

export function useSetOrderStatus() {
  const invalidate = useOrderInvalidation();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: OrderStatus; reason?: string }) =>
      setOrderStatus(id, status, reason),
    onSuccess: invalidate,
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteOrder,
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: qk.order(id) });
      qc.invalidateQueries({ queryKey: qk.ordersAll });
      qc.invalidateQueries({ queryKey: qk.clientsAll });
    },
  });
}
