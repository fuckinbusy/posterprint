/* Стопка нарядов: все заказы колонки одним документом.

   В цех наряды уходят пачкой, а не по одному. Каждый заказ — свой лист,
   на бумаге разделяются разрывом страницы; на экране между ними пунктир,
   чтобы видеть, где кончается один и начинается другой. */

import { useCatalog } from '@/api/catalog';
import { ModalShell, useModalFrame } from '@/app/ModalProvider';
import { Empty } from '@/components/ui';
import { plural } from '@/lib/format';
import type { Order } from '@/types/api';

import { WorkSheet } from './PrintOrderModal';

export function PrintBatchModal({ orders, title }: { orders: Order[]; title: string }) {
  const frame = useModalFrame();
  const { data: catalog } = useCatalog();

  return (
    <ModalShell
      eyebrow={`Наряды · ${title}`}
      title={`${orders.length} ${plural(orders.length, 'наряд', 'наряда', 'нарядов')}`}
      foot={
        <>
          <div className="spacer" />
          <button className="btn btn-ghost" type="button" onClick={frame.close}>
            Закрыть
          </button>
          <button className="btn btn-green" type="button" onClick={() => window.print()}>
            Печать
          </button>
        </>
      }
    >
      {orders.length === 0 ? (
        <Empty>В колонке пусто</Empty>
      ) : (
        <div className="print-stack">
          {orders.map((order) => (
            <WorkSheet
              key={order.id}
              order={order}
              template={catalog?.templates.find((t) => t.key === order.template_key)}
              designFile=""
            />
          ))}
        </div>
      )}
      <p className="print-hint">Каждый наряд уйдёт на отдельную страницу.</p>
    </ModalShell>
  );
}
