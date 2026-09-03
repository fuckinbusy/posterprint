/* Карточка заказа на доске. */

import { useEffect, useRef } from 'react';

import { useCatalog } from '@/api/catalog';
import { useCan } from '@/app/AuthProvider';
import { ArrowIcon, ClockIcon, UserIcon } from '@/components/Icons';
import { useOpenOrder } from '@/features/orders/useOpenOrder';
import { dateRu, money, todayISO } from '@/lib/format';
import type { Order, OrderStatus } from '@/types/api';

import { PayBadge } from './payment';
import { useMoveStatus } from './useMoveStatus';
import { useStatuses } from './useStatuses';

interface OrderCardProps {
  order: Order;
  onContextMenu: (order: Order, x: number, y: number) => void;
}

/* Сколько держать палец, чтобы карточка «поднялась». Меньше — конфликт с
   прокруткой доски, больше — кажется, что не работает. */
const HOLD_MS = 350;
/* Сдвиг пальца до истечения задержки, после которого это прокрутка, а не
   удержание. */
const SCROLL_TOLERANCE = 8;

export function OrderCard({ order, onContextMenu }: OrderCardProps) {
  const can = useCan();
  const statuses = useStatuses();
  const moveStatus = useMoveStatus();
  const openOrder = useOpenOrder();
  const { data: catalog } = useCatalog();

  const template = catalog?.templates.find((t) => t.key === order.template_key);
  const closed = order.status === 'done' || order.status === 'cancelled';
  const overdue = Boolean(order.due_date && order.due_date < todayISO() && !closed);
  const next = statuses.forward(order.status);
  const canDrag = can('orders.status');

  const ref = useRef<HTMLElement>(null);
  // после перетаскивания пальцем следом прилетает click — его надо проглотить,
  // иначе вместе со сменой статуса откроется и карточка
  const swallowClick = useRef(false);

  /* Перетаскивание пальцем. HTML5 drag-and-drop на сенсорных экранах не
     работает вовсе, а доску собираются вешать на планшет в цехе.

     Слушатели вешаем сами, а не через onTouchMove: React регистрирует
     touch-события как passive, и preventDefault в них не действует — палец
     тянул бы и карточку, и всю доску разом. */
  useEffect(() => {
    const el = ref.current;
    if (!el || !canDrag) return undefined;

    let timer = 0;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let over: HTMLElement | null = null;
    let start = { x: 0, y: 0 };

    const clearOver = () => {
      over?.classList.remove('touch-over');
      over = null;
    };
    const finish = () => {
      window.clearTimeout(timer);
      ghost?.remove();
      ghost = null;
      el.classList.remove('dragging');
      document.body.classList.remove('touch-dragging');
      dragging = false;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      timer = window.setTimeout(() => {
        dragging = true;
        const box = el.getBoundingClientRect();
        ghost = el.cloneNode(true) as HTMLElement;
        ghost.classList.add('touch-ghost');
        ghost.style.width = `${box.width}px`;
        ghost.style.left = `${box.left}px`;
        ghost.style.top = `${box.top}px`;
        document.body.append(ghost);
        el.classList.add('dragging');
        document.body.classList.add('touch-dragging');
        // короткая отдача — понятно, что карточка поднялась
        navigator.vibrate?.(15);
      }, HOLD_MS);
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!dragging) {
        // палец поехал раньше срока — это прокрутка, не удержание
        if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > SCROLL_TOLERANCE) {
          window.clearTimeout(timer);
        }
        return;
      }
      e.preventDefault();
      if (ghost) {
        ghost.style.transform = `translate(${t.clientX - start.x}px, ${t.clientY - start.y}px)`;
      }
      // призрак не ловит события (pointer-events: none), поэтому под пальцем
      // видна настоящая колонка
      const col = document.elementFromPoint(t.clientX, t.clientY)?.closest<HTMLElement>('.col') ?? null;
      if (col !== over) {
        clearOver();
        over = col;
        over?.classList.add('touch-over');
      }
    };

    const onEnd = () => {
      const target = over?.dataset.status as OrderStatus | undefined;
      const was = dragging;
      clearOver();
      finish();
      if (!was) return;
      swallowClick.current = true;
      if (target && target !== order.status) void moveStatus(order, target);
    };

    const onCancel = () => {
      clearOver();
      finish();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onCancel);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
      onCancel();
    };
  }, [canDrag, order, moveStatus]);

  const classes = ['card'];
  if (overdue) classes.push('overdue');
  // цветная полоска слева по состоянию оплаты
  if (order.payment !== 'unset' && order.payment !== 'hidden') {
    classes.push('pay-mark', `mark-${order.payment}`);
  }

  return (
    <article
      className={classes.join(' ')}
      ref={ref}
      draggable={canDrag}
      tabIndex={0}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(order.id));
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove('dragging')}
      onClick={() => {
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        openOrder(order.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openOrder(order.id);
        }
        if (e.key === 'ContextMenu') {
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          onContextMenu(order, box.left + 30, box.top + 30);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(order, e.clientX, e.clientY);
      }}
    >
      <div className="card-top">
        <span className="card-num">{order.number}</span>
        <span className="card-tag">{template ? template.short : order.template_key}</span>
      </div>
      <div className="card-title">{order.title}</div>
      <div className="card-sub">
        {order.summary ? `${order.summary} · ${order.quantity} шт` : `${order.quantity} шт`}
      </div>
      {order.client_name && (
        <div className="card-client">
          <UserIcon />
          <span>{order.client_name}</span>
        </div>
      )}
      <div className="card-foot">
        {can('orders.price.view') && (
          <>
            <span className={order.price ? 'card-price' : 'card-price unset'}>
              {order.price ? money(order.price) : 'цена не указана'}
            </span>
            <PayBadge order={order} />
          </>
        )}
        {order.due_date && (
          <span className={overdue ? 'card-due hot' : 'card-due'}>
            <ClockIcon />
            {dateRu(order.due_date)}
          </span>
        )}
        {next && can('orders.status') && (
          <button
            className="card-next"
            type="button"
            title={`В статус «${statuses.title(next)}»`}
            aria-label={`Перевести в «${statuses.title(next)}»`}
            onClick={(e) => {
              // иначе следом откроется карточка заказа
              e.stopPropagation();
              void moveStatus(order, next);
            }}
          >
            <ArrowIcon />
          </button>
        )}
      </div>

      {/* Сколько клиент ещё должен — при выдаче это первое, что нужно знать.
          Показываем только при частичной оплате: там сумму иначе никак не
          увидеть. У неоплаченного заказа доплатить нужно всю стоимость, она
          и так стоит рядом, а метка «Не оплачен» уже об этом говорит. */}
      {can('orders.price.view') && order.payment === 'partial' && order.debt > 0 && (
        <div className="card-debt">
          <span>Доплатить</span>
          <b>{money(order.debt)}</b>
        </div>
      )}
    </article>
  );
}
