/* Шина всплывающих уведомлений о заказах.

   Отдельно от тостов: тост — ответ на действие самого человека («сохранено»),
   а это — событие извне, о котором он не просил: кто-то оформил заказ.
   Такое должно быть заметнее, жить дольше и звучать.

   Модуль без React, чтобы уведомление могла поднять любая часть системы:
   опрос сервера (useFreshOrders), кнопка «Проверить» в профиле. Показывает
   их компонент OrderNotices, подписанный через onNotice. */

import type { Order } from '@/types/api';

export interface Notice {
  id: number;
  order: Order;
  /** через сколько мс скрыть */
  life: number;
  /** проверочное — из профиля, не из опроса */
  test?: boolean;
}

/** Сколько висит уведомление. Достаточно, чтобы поднять голову и прочитать. */
export const NOTICE_LIFE_MS = 15_000;

const listeners = new Set<(notice: Notice) => void>();
let counter = 0;

export function onNotice(fn: (notice: Notice) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function pushNotice(order: Order, options: { test?: boolean } = {}): void {
  counter += 1;
  const notice: Notice = {
    id: counter,
    order,
    life: NOTICE_LIFE_MS,
    test: options.test,
  };
  listeners.forEach((fn) => fn(notice));
}
