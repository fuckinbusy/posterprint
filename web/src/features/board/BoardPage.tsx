/* Доска заказов: колонка на каждый статус. */

import { useEffect, useRef, useState } from 'react';

import { useCatalog } from '@/api/catalog';
import { useOrders } from '@/api/orders';
import type { OrdersFilter } from '@/api/keys';
import { useCan } from '@/app/AuthProvider';
import { money } from '@/lib/format';
import type { Order, OrderStatus, StatusMeta } from '@/types/api';

import { edgeScroll, rememberScroll, restoreScroll, stopEdgeScroll, wheelSideways } from './boardScroll';
import { OrderCard } from './OrderCard';
import { OrderContextMenu, type ContextMenuState } from './OrderContextMenu';
import { sortOrders, type BoardSort } from './sorting';
import { TodayBar, matchesFocus, type BoardFocus } from './TodayBar';
import { useMoveStatus } from './useMoveStatus';
import { useStatuses } from './useStatuses';

interface BoardPageProps {
  filter: OrdersFilter;
  sort: BoardSort;
}

export function BoardPage({ filter, sort }: BoardPageProps) {
  const statuses = useStatuses();
  const orders = useOrders(filter);
  // полоса «Сегодня» и загрузка цеха смотрят на все заказы, а не на
  // отфильтрованные: срочность и загрузка — про цех целиком
  const everything = useOrders({ q: '', templateKey: 'all' });
  const { data: catalog } = useCatalog();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [focus, setFocus] = useState<BoardFocus | null>(null);

  const openMenu = (order: Order, x: number, y: number) => setMenu({ order, x, y });

  /* Прокрутка вбок (см. boardScroll.ts): колесо над шапками — вбок,
     положение помнится между заходами, автопрокрутка при перетаскивании
     останавливается, когда перетаскивание кончилось где угодно. */
  const boardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return undefined;
    restoreScroll(el);
    // колесо — не через onWheel: React вешает его passive, preventDefault не действует
    el.addEventListener('wheel', wheelSideways, { passive: false });
    const remember = () => rememberScroll(el);
    el.addEventListener('scroll', remember, { passive: true });
    document.addEventListener('dragend', stopEdgeScroll);
    document.addEventListener('drop', stopEdgeScroll);
    return () => {
      el.removeEventListener('wheel', wheelSideways);
      el.removeEventListener('scroll', remember);
      document.removeEventListener('dragend', stopEdgeScroll);
      document.removeEventListener('drop', stopEdgeScroll);
      stopEdgeScroll();
    };
  }, []);

  return (
    <div className="board-wrap page">
      <TodayBar
        orders={everything.data ?? []}
        templates={catalog?.templates ?? []}
        focus={focus}
        onFocus={setFocus}
      />
      <main
        className="board"
        aria-label="Доска заказов"
        ref={boardRef}
        // карточку тянут к краю — доска едет сама
        onDragOver={(e) => edgeScroll(e.clientX)}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) stopEdgeScroll();
        }}
      >
        {statuses.statuses.map((status) => (
          <Column
            key={status.key}
            status={status}
            orders={sortOrders(
              (orders.data ?? []).filter((o) => o.status === status.key && matchesFocus(o, focus)),
              sort,
            )}
            allOrders={orders.data ?? []}
            loading={orders.isLoading}
            onContextMenu={openMenu}
          />
        ))}
        {menu && <OrderContextMenu state={menu} onClose={() => setMenu(null)} />}
      </main>
    </div>
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
      data-status={status.key}
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
