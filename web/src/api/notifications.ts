/* Уведомления о новых заказах.

   Сервер спрашивают раз в несколько секунд: «что появилось после заказа
   № N?». Первый ответ только сообщает, где сейчас край (latest_id) — то,
   что оформили до входа, не всплывает. Своё не приходит: заказы, которые
   принял сам человек, сервер отфильтровывает по имени профиля.

   Опрос идёт и в свёрнутой вкладке: планшет в цехе лежит с погашенным
   экраном, и звук про новый заказ должен прозвучать всё равно. Браузер
   сам растянет интервал в фоне до минуты — это приемлемо. */

import { useEffect, useRef } from 'react';

import { useAuth } from '@/app/AuthProvider';
import type { FreshOrders } from '@/types/api';

import { request } from './client';

export const POLL_MS = 12_000;

export const fetchFreshOrders = (after: number | null): Promise<FreshOrders> =>
  request<FreshOrders>(`/orders/fresh${after === null ? '' : `?after=${after}`}`);

/** Опрос новых заказов; на каждый новый зовёт onFresh. Работает только у
 *  профиля с правом notify.orders. */
export function useFreshOrders(onFresh: (fresh: FreshOrders) => void): void {
  const { session, can } = useAuth();
  const enabled = Boolean(session) && can('notify.orders');
  const after = useRef<number | null>(null);
  const handler = useRef(onFresh);
  handler.current = onFresh;

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let busy = false;

    const poll = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const fresh = await fetchFreshOrders(after.current);
        if (stopped) return;
        // первый ответ — только точка отсчёта
        if (after.current !== null && fresh.orders.length > 0) handler.current(fresh);
        after.current = fresh.latest_id;
      } catch {
        // сервер недоступен — молчим, следующий раз спросим снова
      } finally {
        busy = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    // вкладку развернули — спросить сразу, не дожидаясь интервала
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
