/* Всплывающие уведомления о новых заказах — справа сверху, под шапкой.

   Появляются только у профиля с правом «Получать уведомления о новых
   заказах» и только о чужих заказах: свой человек и так видит. Коротко —
   номер, что за работа, клиент, срок и сумма (если её можно видеть);
   кнопка «Открыть» ведёт в карточку, крестик прячет, само пропадает через
   NOTICE_LIFE_MS. Полоска внизу показывает, сколько осталось; под курсором
   отсчёт замирает — пока читают, не исчезнет.

   Звук — короткий сигнал (lib/chime.ts), выключается в профиле. В свёрнутой
   вкладке дополнительно показывается системное уведомление браузера, если
   человек его разрешил (кнопка тоже в профиле). */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useFreshOrders } from '@/api/notifications';
import { useCan } from '@/app/AuthProvider';
import { usePref } from '@/app/prefs';
import { BellIcon, CloseIcon } from '@/components/Icons';
import { useOpenOrder } from '@/features/orders/useOpenOrder';
import { playChime, unlockAudio } from '@/lib/chime';
import { dateRu, money } from '@/lib/format';
import type { Order } from '@/types/api';

import { onNotice, pushNotice, type Notice } from './notices';

export const NOTIFY_SOUND = ['on', 'off'] as const;
export type NotifySound = (typeof NOTIFY_SOUND)[number];

export function OrderNotices() {
  const can = useCan();
  const [items, setItems] = useState<Notice[]>([]);
  const [sound] = usePref<NotifySound>('notify.sound', 'on', NOTIFY_SOUND);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((n) => n.id !== id)), []);

  // звук можно только после первого жеста — разблокируем заранее
  useEffect(() => unlockAudio(), []);

  // всё, что кто-то поднял через pushNotice, — в стопку
  useEffect(
    () =>
      onNotice((notice) => {
        setItems((prev) => [...prev.slice(-4), notice]);
        if (soundRef.current === 'on') playChime();
        if (document.visibilityState === 'hidden') systemNotice(notice.order);
      }),
    [],
  );

  // опрос сервера: новые чужие заказы
  useFreshOrders((fresh) => fresh.orders.forEach((order) => pushNotice(order)));

  if (items.length === 0) return null;
  return (
    <div className="notices" role="status" aria-live="polite" aria-label="Новые заказы">
      {items.map((notice) => (
        <NoticeCard
          key={notice.id}
          notice={notice}
          showMoney={can('orders.price.view')}
          onClose={() => dismiss(notice.id)}
        />
      ))}
    </div>
  );
}

function NoticeCard({
  notice,
  showMoney,
  onClose,
}: {
  notice: Notice;
  showMoney: boolean;
  onClose: () => void;
}) {
  const openOrder = useOpenOrder();
  const { order } = notice;
  const [paused, setPaused] = useState(false);
  // сколько осталось жить — считаем сами, чтобы пауза под курсором работала
  const left = useRef(notice.life);
  const since = useRef(Date.now());

  useEffect(() => {
    if (paused) return undefined;
    since.current = Date.now();
    const timer = window.setTimeout(onClose, left.current);
    return () => {
      window.clearTimeout(timer);
      left.current = Math.max(left.current - (Date.now() - since.current), 0);
    };
  }, [paused, onClose]);

  const details = [
    order.client_name,
    order.due_date ? `к ${dateRu(order.due_date)}` : '',
    showMoney && order.price ? money(order.price) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={paused ? 'notice paused' : 'notice'}
      style={{ '--life': `${notice.life}ms` } as React.CSSProperties}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="notice-icon">
        <BellIcon />
      </div>
      <div className="notice-body">
        <span className="notice-eyebrow">{notice.test ? 'Проверка уведомлений' : 'Новый заказ'}</span>
        <b className="notice-title">
          {order.number} · {order.title}
        </b>
        {details && <span className="notice-sub">{details}</span>}
        {order.manager && <span className="notice-who">принял {order.manager}</span>}
      </div>
      <div className="notice-actions">
        {!notice.test && (
          <button
            className="btn btn-green"
            type="button"
            onClick={() => {
              onClose();
              openOrder(order.id);
            }}
          >
            Открыть
          </button>
        )}
        <button className="icon-btn" type="button" aria-label="Скрыть уведомление" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <i className="notice-bar" aria-hidden="true" />
    </div>
  );
}

/* ---------------------------------------------------- системное уведомление */
export const systemNoticesAllowed = (): boolean =>
  typeof Notification !== 'undefined' && Notification.permission === 'granted';

export const systemNoticesPossible = (): boolean =>
  typeof Notification !== 'undefined' && Notification.permission !== 'denied';

export async function askSystemNotices(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function systemNotice(order: Order) {
  if (!systemNoticesAllowed()) return;
  try {
    const n = new Notification(`Новый заказ ${order.number}`, {
      body: [order.title, order.client_name].filter(Boolean).join(' · '),
      tag: `order-${order.id}`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* браузер без уведомлений — не страшно, всплывашка на экране есть */
  }
}
