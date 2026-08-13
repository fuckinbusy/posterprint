/* Доска заказов: колонка на каждый статус. */

import { useState } from 'react';

import { useOrders } from '@/api/orders';
import type { OrdersFilter } from '@/api/keys';
import { useCan } from '@/app/AuthProvider';
import { money } from '@/lib/format';
import type { Order, OrderStatus, StatusMeta } from '@/types/api';

import { OrderCard } from './OrderCard';
import { OrderContextMenu, type ContextMenuState } from './OrderContextMenu';
import { sortOrders, type BoardSort } from './sorting';
import { useMoveStatus } from './useMoveStatus';
import { useStatuses } from './useStatuses';

interface BoardPageProps {
  filter: OrdersFilter;
  sort: BoardSort;
}

export function BoardPage({ filter, sort }: BoardPageProps) {
  const statuses = useStatuses();
  const orders = useOrders(filter);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const openMenu = (order: Order, x: number, y: number) => setMenu({ order, x, y });

  return (
    <main className="board page" aria-label="Доска заказов">
      {statuses.statuses.map((status) => (
        <Column
          key={status.key}
          status={status}
          orders={sortOrders(
            (orders.data ?? []).filter((o) => o.status === status.key),
            sort,
          )}
          allOrders={orders.data ?? []}
          loading={orders.isLoading}
          onContextMenu={openMenu}
        />
      ))}
      {menu && <OrderContextMenu state={menu} onClose={() => setMenu(null)} />}
    </main>
  );
}

interface ColumnProps {
  status: StatusMeta;
  orders: Order[];
  /** весь список доски: перетаскивание отдаёт только id, а для проверки
   *  перехода нужен сам заказ */
  allOrders: Order[];
  loading: boolean;
  onContextMenu: (order: Order, x: number, y: number) => void;
}

function Column({ status, orders, allOrders, loading, onContextMenu }: ColumnProps) {
  const can = useCan();
  const moveStatus = useMoveStatus();
  const [over, setOver] = useState(false);

  /* Сумма по колонке. У отменённых её не показываем: это деньги, которых не
     будет, а выглядели они ровно как выручка в «Выдан» — да ещё и с заказами,
     по которым делали возврат. Вместо суммы остаётся подпись статуса. */
  const sum =
    status.key === 'cancelled' ? 0 : orders.reduce((acc, o) => acc + (o.price || 0), 0);

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const order = allOrders.find((o) => o.id === id);
    if (order) void moveStatus(order, status.key as OrderStatus);
  };

  return (
    <section
      className={over ? 'col drop' : 'col'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className="col-head">
        <div className="col-top">
          <span className="col-dot" style={{ background: status.color }} />
          <span className="col-title">{status.title}</span>
          <span className="col-count">{orders.length}</span>
        </div>
        <div className="col-sum">
          {sum && can('finance.totals') ? <b>{money(sum)}</b> : status.hint}
        </div>
      </div>
      <div className="col-body">
        {orders.length === 0 ? (
          <div className="col-empty">
            {loading ? 'Загружаю…' : status.key === 'new' ? 'Пусто. Создайте заказ' : 'Пусто'}
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard key={order.id} order={order} onContextMenu={onContextMenu} />
          ))
        )}
      </div>
    </section>
  );
}
