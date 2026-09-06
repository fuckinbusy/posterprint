/* Всплывающие уведомления — справа сверху, под шапкой.

   Два повода: кто-то другой оформил заказ (право notify.orders) и в рабочий
   ящик пришло письмо (право mail.access). Коротко — кто, что, когда; кнопка
   «Открыть» ведёт в карточку заказа или в письмо, крестик прячет, само
   пропадает через NOTICE_LIFE_MS. Полоска внизу показывает, сколько
   осталось; под курсором отсчёт замирает — пока читают, не исчезнет.

   Звук — короткий сигнал (lib/chime.ts), выключается в профиле. В свёрнутой
   вкладке дополнительно показывается системное уведомление браузера, если
   человек его разрешил (кнопка тоже в профиле). */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useFreshMail, type MailSummary } from '@/api/mail';
import { useFreshOrders } from '@/api/notifications';
import { useCan } from '@/app/AuthProvider';
import { usePref } from '@/app/prefs';
import { BellIcon, CloseIcon, NavMailIcon } from '@/components/Icons';
import { useOpenOrder } from '@/features/orders/useOpenOrder';
import { playChime, unlockAudio } from '@/lib/chime';
import { dateRu, money } from '@/lib/format';
import type { Order } from '@/types/api';

import { onNotice, pushMailNotice, pushNotice, type Notice } from './notices';

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

  // всё, что кто-то поднял через шину, — в стопку
  useEffect(
    () =>
      onNotice((notice) => {
        setItems((prev) => [...prev.slice(-4), notice]);
        if (soundRef.current === 'on') playChime();
        if (document.visibilityState === 'hidden') systemNotice(notice);
      }),
    [],
  );

  // опрос сервера: новые чужие заказы и новые письма
  useFreshOrders((fresh) => fresh.orders.forEach((order) => pushNotice(order)));
  useFreshMail((messages) => messages.forEach((mail) => pushMailNotice(mail)));

  if (items.length === 0) return null;
  return (
    <div className="notices" role="status" aria-live="polite" aria-label="Уведомления">
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
  const navigate = useNavigate();
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

  const view = describe(notice, showMoney);
  const open = () => {
    onClose();
    if (notice.kind === 'order') openOrder(notice.order.id);
    else navigate(`/mail?uid=${notice.mail.uid}`);
  };

  return (
    <div
      className={['notice', notice.kind, paused ? 'paused' : ''].filter(Boolean).join(' ')}
      style={{ '--life': `${notice.life}ms` } as React.CSSProperties}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="notice-icon">{notice.kind === 'mail' ? <NavMailIcon /> : <BellIcon />}</div>
      <div className="notice-body">
        <span className="notice-eyebrow">{view.eyebrow}</span>
        <b className="notice-title">{view.title}</b>
        {view.sub && <span className="notice-sub">{view.sub}</span>}
        {view.who && <span className="notice-who">{view.who}</span>}
      </div>
      <div className="notice-actions">
        {!notice.test && (
          <button className="btn btn-green" type="button" onClick={open}>
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

/** Текст карточки — одинаково для всплывашки и системного уведомления. */
function describe(
  notice: Notice,
  showMoney: boolean,
): { eyebrow: string; title: string; sub: string; who: string } {
  if (notice.kind === 'mail') {
    const m = notice.mail;
    return {
      eyebrow: notice.test ? 'Проверка уведомлений' : 'Новое письмо',
      title: m.from.name || m.from.email,
      sub: m.subject,
      who: m.from.name ? m.from.email : '',
    };
  }
  const order: Order = notice.order;
  return {
    eyebrow: notice.test ? 'Проверка уведомлений' : 'Новый заказ',
    title: `${order.number} · ${order.title}`,
    sub: [
      order.client_name,
      order.due_date ? `к ${dateRu(order.due_date)}` : '',
      showMoney && order.price ? money(order.price) : '',
    ]
      .filter(Boolean)
      .join(' · '),
    who: order.manager ? `принял ${order.manager}` : '',
  };
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

function systemNotice(notice: Notice) {
  if (!systemNoticesAllowed()) return;
  const view = describe(notice, false);
  try {
    const n = new Notification(`${view.eyebrow}: ${view.title}`, {
      body: view.sub,
      tag:
        notice.kind === 'order'
          ? `order-${notice.order.id}`
          : `mail-${(notice as { mail: MailSummary }).mail.uid}`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* браузер без уведомлений — не страшно, всплывашка на экране есть */
  }
}
