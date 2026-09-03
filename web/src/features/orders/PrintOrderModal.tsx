/* Печать заказа: квитанция клиенту и наряд в цех.

   Два разных документа, потому что читают их разные люди и с разной целью.
   Клиенту нужны номер, сумма и когда приходить. Цеху — что делать, из чего
   и к какому сроку, а цены он видеть не должен: их и так закрывают правом
   orders.price.view, и печать не должна быть дырой в этом правиле.

   Как это печатается. Лист живёт прямо в окне — то, что видно на экране,
   и уходит на бумагу, отдельного «предпросмотра» нет. Печатью занимается
   CSS (раздел «печать» в static/css/app.css): при печати прячется всё, кроме
   листа, а сам лист распрямляется в обычный поток, чтобы длинный заказ
   переполз на вторую страницу, а не обрезался. */

import { useState } from 'react';

import { useCatalog } from '@/api/catalog';
import { useDesignInfo } from '@/api/designs';
import { useCan } from '@/app/AuthProvider';
import { ModalBackButton, ModalShell } from '@/app/ModalProvider';
import { dateFullRu, dtRu, moneyOrZero } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import type { FormTemplate, Order, ShopDetails } from '@/types/api';

import { orderParamRows } from './params';

type SheetKind = 'receipt' | 'work';

export function PrintOrderModal({ order }: { order: Order }) {
  const can = useCan();
  const { data: catalog } = useCatalog();

  // Квитанция — про деньги, поэтому она есть только у того, кто их видит.
  // Остальным доступен наряд: там цен нет и быть не должно.
  const canReceipt = can('orders.price.view');
  const [kind, setKind] = useState<SheetKind>(canReceipt ? 'receipt' : 'work');

  const template = catalog?.templates.find((t) => t.key === order.template_key);
  const design = useDesignInfo(order.id, can('design.view'));

  return (
    <ModalShell
      eyebrow={`Печать · ${order.number}`}
      title={kind === 'receipt' ? 'Квитанция клиенту' : 'Наряд в цех'}
      foot={
        <>
          <div className="spacer" />
          <ModalBackButton />
          <button className="btn btn-green" type="button" onClick={() => window.print()}>
            Печать
          </button>
        </>
      }
    >
      {canReceipt && (
        <div className="print-switch">
          <button
            className={kind === 'receipt' ? 'active' : ''}
            type="button"
            onClick={() => setKind('receipt')}
          >
            Квитанция клиенту
          </button>
          <button
            className={kind === 'work' ? 'active' : ''}
            type="button"
            onClick={() => setKind('work')}
          >
            Наряд в цех
          </button>
        </div>
      )}

      {kind === 'receipt' ? (
        <ReceiptSheet order={order} template={template} shop={catalog?.shop} />
      ) : (
        <WorkSheet
          order={order}
          template={template}
          // без права на макеты строку не печатаем вовсе: «не приложен»
          // было бы неправдой — мы просто не знаем
          designFile={can('design.view') ? (design.data?.exists ? design.data.filename : '—') : ''}
        />
      )}

      <p className="print-hint">
        Так документ и напечатается. Размер листа и поля — в окне печати
        браузера; для квитанции обычно хватает A5.
      </p>
    </ModalShell>
  );
}

/* ---------------------------------------------------------- квитанция */
function ReceiptSheet({
  order,
  template,
  shop,
}: {
  order: Order;
  template: FormTemplate | undefined;
  shop: ShopDetails | undefined;
}) {
  const rows = orderParamRows(template, order);
  const cancelled = order.status === 'cancelled';

  return (
    <div className="print-sheet">
      <ShopHead shop={shop} />

      <div className="ps-title">
        <span>Квитанция к заказу</span>
        <b>{order.number}</b>
      </div>

      {cancelled && <div className="ps-stamp">Заказ отменён</div>}
      <div className="ps-sub">
        Принят {dtRu(order.created_at)}
        {order.manager ? ` · ${order.manager}` : ''}
      </div>

      {(order.client_name || order.client_phone) && (
        <div className="ps-line">
          <span>Клиент</span>
          <b>
            {[order.client_name, formatPhone(order.client_phone)].filter(Boolean).join(' · ')}
          </b>
        </div>
      )}

      <WorkTable order={order} template={template} rows={rows} />

      <MoneyBlock order={order} />

      {!cancelled && order.due_date && (
        <div className="ps-line big">
          <span>Готово к выдаче</span>
          <b>{dateFullRu(order.due_date)}</b>
        </div>
      )}

      <div className="ps-foot">
        {/* у отменённого заказа «приходите забирать» — прямая дезинформация */}
        <span>{cancelled ? 'Заказ отменён, работа не выполняется.' : 'При получении назовите номер заказа.'}</span>
        <span className="ps-sign">Принял: ____________________</span>
      </div>

      <PrintedAt />
    </div>
  );
}

/* ---------------------------------------------------------- наряд в цех */
function WorkSheet({
  order,
  template,
  designFile,
}: {
  order: Order;
  template: FormTemplate | undefined;
  designFile: string;
}) {
  const rows = orderParamRows(template, order);

  return (
    <div className="print-sheet">
      <div className="ps-work-head">
        <div>
          <span>Наряд</span>
          <b>{order.number}</b>
        </div>
        <div className="ps-due">
          <span>Срок</span>
          <b>{order.due_date ? dateFullRu(order.due_date) : 'не задан'}</b>
        </div>
      </div>

      <div className="ps-name">{order.title}</div>

      {/* Имя клиента — чтобы готовую работу не искали по всей полке.
          Телефон и почта не нужны: в цех с ними никто не звонит. */}
      {order.client_name && (
        <div className="ps-line">
          <span>Клиент</span>
          <b>{order.client_name}</b>
        </div>
      )}

      {/* Цен здесь нет намеренно: наряд ходит по цеху, а стоимость заказа
          закрыта отдельным правом. */}
      <WorkTable order={order} template={template} rows={rows} />

      {designFile && (
        <div className="ps-line">
          <span>Макет</span>
          <b>{designFile === '—' ? 'не приложен' : designFile}</b>
        </div>
      )}

      {order.notes && (
        <div className="ps-notes">
          <span>Комментарий</span>
          <p>{order.notes}</p>
        </div>
      )}

      <div className="ps-marks">
        <span>Отметки</span>
        <div>
          <i>Сделано ____________</i>
          <i>Проверено ____________</i>
          <i>Выдано ____________</i>
        </div>
      </div>

      <div className="ps-foot">
        <span>
          Принял: {order.manager || '—'} · {dtRu(order.created_at)}
        </span>
      </div>

      <PrintedAt />
    </div>
  );
}

/** Деньги в квитанции. Главная строка — крупная рамка справа: с ней клиент
 *  придёт забирать заказ. Ноль в ней писать нельзя: «К доплате 0 ₽» человек
 *  читает мельком и переспрашивает, сколько же он должен. */
function MoneyBlock({ order }: { order: Order }) {
  const settled = !order.refunded && order.price > 0 && order.debt <= 0;

  return (
    <div className="ps-money">
      <div>
        <span>Стоимость</span>
        <b>{order.price ? moneyOrZero(order.price) : 'не указана'}</b>
      </div>
      <div>
        <span>Внесено</span>
        <b>{moneyOrZero(order.prepaid)}</b>
      </div>
      {order.refunded ? (
        <div className="big">
          <span>Возвращено клиенту</span>
          <b>{moneyOrZero(order.prepaid)}</b>
        </div>
      ) : order.surplus > 0 ? (
        <div className="big">
          <span>Переплата</span>
          <b>{moneyOrZero(order.surplus)}</b>
        </div>
      ) : (
        <div className="big">
          <span>{settled ? 'Оплата' : 'К доплате'}</span>
          <b>{settled ? 'полностью' : moneyOrZero(order.debt)}</b>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- общие куски */
function ShopHead({ shop }: { shop: ShopDetails | undefined }) {
  const contacts = [shop?.phone, shop?.address, shop?.note].filter(Boolean).join(' · ');
  if (!shop?.name && !contacts) return null;
  return (
    <div className="ps-shop">
      {shop?.name && <b>{shop.name}</b>}
      {contacts && <span>{contacts}</span>}
    </div>
  );
}

function WorkTable({
  order,
  template,
  rows,
}: {
  order: Order;
  template: FormTemplate | undefined;
  rows: [string, string][];
}) {
  return (
    <table className="ps-table">
      <tbody>
        <tr>
          <th>Вид работ</th>
          <td>{template?.title ?? order.template_key}</td>
        </tr>
        <tr>
          <th>Количество</th>
          <td>{order.quantity} шт</td>
        </tr>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Когда напечатали. На двух копиях одного заказа сразу видно, какая свежее. */
function PrintedAt() {
  return (
    <div className="ps-printed">
      Напечатано {new Date().toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </div>
  );
}
