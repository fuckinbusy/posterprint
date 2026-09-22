/* Доска заказов: колонка на каждый статус. */

import { useEffect, useRef, useState } from 'react';

import { useCatalog } from '@/api/catalog';
import { useOrders } from '@/api/orders';
import type { OrdersFilter } from '@/api/keys';
import { useCan } from '@/app/AuthProvider';
import { money } from '@/lib/format';
import type { Order, OrderStatus, StatusMeta } from '@/types/api';

import {
  EDGE,
  canScroll,
  edgeScroll,
  onEdgeScroll,
  rememberScroll,
  restoreScroll,
  stopEdgeScroll,
  wheelSideways,
  type EdgeSide,
} from './boardScroll';
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

  /* Прокрутка вбок (см. boardScroll.ts). Здесь: курсор у края — доска
     едет (с задержкой, чтобы не срабатывать на проезжающую мимо мышь),
     колесо над шапками — вбок, положение помнится между заходами, а по
     краям — индикатор: есть ли ещё колонки и едет ли доска сейчас. */
  const boardRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [moving, setMoving] = useState<EdgeSide>(null);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return undefined;
    restoreScroll(el);

    const update = () => {
      const next = {
        left: canScroll(el, 'left'),
        right: canScroll(el, 'right'),
      };
      setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const onScroll = () => {
      rememberScroll(el);
      update();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // колесо — не через onWheel: React вешает его passive, preventDefault не действует
    el.addEventListener('wheel', wheelSideways, { passive: false });

    // курсор у края: ждём HOLD_MS — если он всё ещё там, едем
    const HOLD_MS = 220;
    let timer = 0;
    let armed = false;
    let x = 0;
    const inZone = (clientX: number) => {
      const box = el.getBoundingClientRect();
      return clientX < box.left + EDGE || clientX > box.right - EDGE;
    };
    const disarm = () => {
      window.clearTimeout(timer);
      timer = 0;
      if (armed) {
        armed = false;
        stopEdgeScroll();
      }
    };
    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      if (!inZone(x)) {
        disarm();
        return;
      }
      if (armed) {
        edgeScroll(x);
        return;
      }
      if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          armed = true;
          edgeScroll(x);
        }, HOLD_MS);
      }
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', disarm);
    // перетаскивание кончилось где угодно — стоп
    document.addEventListener('dragend', stopEdgeScroll);
    document.addEventListener('drop', stopEdgeScroll);
    const unsubscribe = onEdgeScroll(setMoving);
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', wheelSideways);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', disarm);
      document.removeEventListener('dragend', stopEdgeScroll);
      document.removeEventListener('drop', stopEdgeScroll);
      unsubscribe();
      disarm();
      stopEdgeScroll();
    };
  }, []);

  const edgeClass = (side: 'left' | 'right') =>
    ['board-edge', side, edges[side] ? 'can' : '', moving === side ? 'on' : ''].filter(Boolean).join(' ');

  return (
    <div className="board-wrap page">
      <TodayBar
        orders={everything.data ?? []}
        templates={catalog?.templates ?? []}
        focus={focus}
        onFocus={setFocus}
      />
      <div className="board-scroller">
        <main
          className="board"
          aria-label="Доска заказов"
          ref={boardRef}
          // карточку тянут к краю — доска едет сама, без задержки
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
        {/* индикатор: тень со стрелкой — за краем ещё колонки; горит — едем */}
        <div className={edgeClass('left')} aria-hidden="true">
          <span>‹</span>
        </div>
        <div className={edgeClass('right')} aria-hidden="true">
          <span>›</span>
        </div>
      </div>
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
  const sum = status.key === 'cancelled' ? 0 : orders.reduce((acc, o) => acc + (o.price || 0), 0);

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
        <div className="col-sum">{sum && can('finance.totals') ? <b>{money(sum)}</b> : status.hint}</div>
      </div>
      <div className="col-body">
        {orders.length === 0 ? (
          <div className="col-empty">
            {loading ? 'Загружаю…' : status.key === 'new' ? 'Пусто. Создайте заказ' : 'Пусто'}
          </div>
        ) : (
          orders.map((order) => <OrderCard key={order.id} order={order} onContextMenu={onContextMenu} />)
        )}
      </div>
    </section>
  );
}
