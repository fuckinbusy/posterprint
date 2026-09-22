/* Меню по правой кнопке на карточке заказа. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useCan } from '@/app/AuthProvider';
import { useModal } from '@/app/ModalProvider';
import { CopyIcon, EditIcon, OpenIcon, PrintIcon, TrashIcon } from '@/components/Icons';
import { useToast } from '@/app/ToastProvider';
import { PrintOrderModal } from '@/features/orders/PrintOrderModal';
import { useDeleteOrderFlow } from '@/features/orders/useDeleteOrderFlow';
import { useOpenOrder } from '@/features/orders/useOpenOrder';
import { useOpenOrderForm } from '@/features/orders/useOpenOrderForm';
import { copyText } from '@/lib/clipboard';
import type { Order } from '@/types/api';

import { useMoveStatus } from './useMoveStatus';
import { useStatuses } from './useStatuses';

export interface ContextMenuState {
  order: Order;
  x: number;
  y: number;
}

/** Отступ от края экрана, чтобы меню не прилипало вплотную. */
const EDGE = 8;

export function OrderContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  const can = useCan();
  const { toast } = useToast();
  const statuses = useStatuses();
  const moveStatus = useMoveStatus();
  const openOrder = useOpenOrder();
  const openForm = useOpenOrderForm();
  const deleteOrder = useDeleteOrderFlow();
  const modal = useModal();

  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });

  // Сначала рисуем, потом двигаем: до отрисовки не знаем размер меню,
  // а без него не понять, влезает ли оно вниз и вправо.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(EDGE, Math.min(state.x, window.innerWidth - box.width - EDGE)),
      top: Math.max(EDGE, Math.min(state.y, window.innerHeight - box.height - EDGE)),
    });
    // фокус — внутрь меню: иначе с клавиатуры до него не добраться
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [state.x, state.y]);

  // закрывается от любого действия мимо себя
  useEffect(() => {
    /* Событие может прийти не от элемента (документ, текстовый узел) —
     * тогда closest() просто нет, и обработчик падал бы с ошибкой. */
    const inside = (target: EventTarget | null, selector: string) =>
      target instanceof Element && target.closest(selector) !== null;

    const onDown = (e: MouseEvent) => {
      if (!inside(e.target, '.ctx')) onClose();
    };
    const onContext = (e: MouseEvent) => {
      if (!inside(e.target, '.card')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc в первую очередь закрывает меню, а не окно под ним
        e.stopPropagation();
        onClose();
        return;
      }
      // стрелки ходят по пунктам, как в любом меню; Enter нажимает кнопку сам
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (items.length === 0) return;
        e.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        items[(current + step + items.length) % items.length].focus();
      }
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onContext);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onContext);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const { order } = state;
  const allowed = statuses.allowedFrom(order.status);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div className="ctx" role="menu" ref={ref} style={{ left: position.left, top: position.top }}>
      <div className="ctx-num">
        {order.number} · {order.title}
      </div>

      <button className="ctx-item" type="button" role="menuitem" onClick={run(() => openOrder(order.id))}>
        <OpenIcon />
        Открыть
      </button>

      {can('orders.edit') && (
        <button className="ctx-item" type="button" role="menuitem" onClick={run(() => openForm(order))}>
          <EditIcon />
          Изменить
        </button>
      )}

      <button
        className="ctx-item"
        type="button"
        onClick={run(async () => {
          const ok = await copyText(order.number);
          toast(ok ? `Номер ${order.number} скопирован` : 'Не удалось скопировать');
        })}
      >
        <CopyIcon />
        Скопировать номер
      </button>

      {/* печать сразу отсюда: раньше — открыть карточку, «Печать», выбрать
          документ; на каждом заказе это два лишних нажатия */}
      <div className="ctx-sep" />
      <div className="ctx-head">Печать</div>
      {can('orders.price.view') && (
        <button
          className="ctx-item"
          type="button"
          role="menuitem"
          onClick={run(() => modal.open(<PrintOrderModal order={order} initialKind="receipt" />))}
        >
          <PrintIcon />
          Квитанция клиенту
        </button>
      )}
      <button
        className="ctx-item"
        type="button"
        role="menuitem"
        onClick={run(() => modal.open(<PrintOrderModal order={order} initialKind="work" />))}
      >
        <PrintIcon />
        Наряд в цех
      </button>
      <button
        className="ctx-item"
        type="button"
        role="menuitem"
        onClick={run(() => modal.open(<PrintOrderModal order={order} initialKind="label" />))}
      >
        <PrintIcon />
        Бирка
      </button>

      {can('orders.status') && (
        <>
          <div className="ctx-sep" />
          <div className="ctx-head">Перенести в</div>
          {statuses.statuses
            .filter((s) => s.key !== order.status)
            .map((s) => (
              <button
                className="ctx-item"
                type="button"
                role="menuitem"
                key={s.key}
                disabled={!allowed.includes(s.key)}
                onClick={run(() => void moveStatus(order, s.key))}
              >
                <span className="ctx-dot" style={{ background: s.color }} />
                {s.title}
              </button>
            ))}
        </>
      )}

      {can('orders.delete') && (
        <>
          <div className="ctx-sep" />
          <button
            className="ctx-item danger"
            type="button"
            role="menuitem"
            onClick={run(() => void deleteOrder(order))}
          >
            <TrashIcon />
            Удалить
          </button>
        </>
      )}
    </div>
  );
}
