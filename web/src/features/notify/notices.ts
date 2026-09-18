/* Шина всплывающих уведомлений: новые заказы и новые письма.

   Отдельно от тостов: тост — ответ на действие самого человека («сохранено»),
   а это — событие извне, о котором он не просил: кто-то оформил заказ,
   клиент написал. Такое должно быть заметнее, жить дольше и звучать.

   Модуль без React, чтобы уведомление могла поднять любая часть системы:
   опрос сервера, кнопка «Проверить» в профиле. Показывает их компонент
   OrderNotices, подписанный через onNotice. */

import type { MailBox, MailSummary } from '@/api/mail';
import type { Order } from '@/types/api';

export type Notice =
  | { id: number; kind: 'order'; order: Order; life: number; test?: boolean }
  | { id: number; kind: 'mail'; mail: MailSummary; box?: MailBox; life: number; test?: boolean };

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

function emit(notice: Notice) {
  listeners.forEach((fn) => fn(notice));
}

export function pushNotice(order: Order, options: { test?: boolean } = {}): void {
  counter += 1;
  emit({ id: counter, kind: 'order', order, life: NOTICE_LIFE_MS, test: options.test });
}

export function pushMailNotice(mail: MailSummary, options: { test?: boolean; box?: MailBox } = {}): void {
  counter += 1;
  emit({ id: counter, kind: 'mail', mail, box: options.box, life: NOTICE_LIFE_MS, test: options.test });
}
