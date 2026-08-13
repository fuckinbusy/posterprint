/* Ключи кэша TanStack Query — в одном месте.

   Зачем не строками по месту: после мутации нужно сбросить именно то, что
   устарело. Раньше это делалось вызовом renderStaffPage() руками, и любой
   забытый вызов оставлял на экране старые данные. Здесь видно всё дерево
   ключей разом, и invalidate писать не на глаз. */

import type { ClientSort } from '@/types/api';

export interface OrdersFilter {
  q: string;
  templateKey: string;
}

export interface ClientsFilter {
  q: string;
  sort: ClientSort;
  offset: number;
}

export const qk = {
  catalog: ['catalog'] as const,

  orders: (filter: OrdersFilter) => ['orders', filter] as const,
  /** любые списки заказов — для сброса после создания и удаления */
  ordersAll: ['orders'] as const,
  order: (id: number) => ['order', id] as const,

  clients: (filter: ClientsFilter) => ['clients', 'list', filter] as const,
  clientsAll: ['clients'] as const,
  clientsSummary: ['clients', 'summary'] as const,
  clientSearch: (q: string) => ['clients', 'search', q] as const,
  client: (id: number) => ['clients', 'card', id] as const,
  clientOrders: (id: number, offset: number) => ['clients', 'card', id, 'orders', offset] as const,

  prices: ['prices'] as const,

  templates: ['templates'] as const,
  templateMeta: ['templates', 'meta'] as const,

  employees: ['employees'] as const,
  permissions: ['permissions'] as const,
  devices: ['devices'] as const,

  metrics: (days: number) => ['metrics', days] as const,

  design: (orderId: number) => ['design', orderId] as const,

  /** QR и реквизиты для оплаты; сумма входит в ключ — на каждую свой код */
  payment: (orderId: number, amount: number) => ['payment', orderId, amount] as const,
};
