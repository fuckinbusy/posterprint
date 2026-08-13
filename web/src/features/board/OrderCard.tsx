/* Карточка заказа на доске. */

import { useCatalog } from '@/api/catalog';
import { useCan } from '@/app/AuthProvider';
import { ArrowIcon, ClockIcon, UserIcon } from '@/components/Icons';
import { useOpenOrder } from '@/features/orders/useOpenOrder';
import { dateRu, money, todayISO } from '@/lib/format';
import type { Order } from '@/types/api';

import { PayBadge } from './payment';
import { useMoveStatus } from './useMoveStatus';
import { useStatuses } from './useStatuses';

interface OrderCardProps {
  order: Order;
  onContextMenu: (order: Order, x: number, y: number) => void;
}

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

  const classes = ['card'];
  if (overdue) classes.push('overdue');
  // цветная полоска слева по состоянию оплаты
  if (order.payment !== 'unset' && order.payment !== 'hidden') {
    classes.push('pay-mark', `mark-${order.payment}`);
  }

  return (
    <article
      className={classes.join(' ')}
      draggable={canDrag}
      tabIndex={0}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(order.id));
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove('dragging')}
      onClick={() => openOrder(order.id)}
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
