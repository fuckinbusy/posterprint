/* Печать заказа: квитанция клиенту и наряд в цех.

   Два разных документа, потому что читают их разные люди и с разной целью.
   Клиенту нужны номер, сумма и когда приходить. Цеху — что делать, из чего
   и к какому сроку, а цены он видеть не должен: их и так закрывают правом
   orders.price.view, и печать не должна быть дырой в этом правиле.

   Как это печатается. Лист живёт прямо в окне — то, что видно на экране,
   и уходит на бумагу, отдельного «предпросмотра» нет. Печатью занимается
   CSS (раздел «печать» в static/css/app.css): при печати прячется всё, кроме
   листа, а сам лист распрямляется в обычный поток, чтобы длинный заказ
   переполз на вторую страницу, а не обрезался.

   Размер листа выбирается здесь, а не в окне печати браузера: квитанции
   идут на A5, наряды на A4, и переключать это каждый раз в диалоге принтера
   надоедает. Выбор запоминается на этом компьютере. */

import { useState } from 'react';

import { useCatalog } from '@/api/catalog';
import { usePageSize } from '@/lib/printPage';
import { useDesignInfo } from '@/api/designs';
import { useCan } from '@/app/AuthProvider';
import { ModalBackButton, ModalShell } from '@/app/ModalProvider';
import { dateFullRu, dtRu, moneyOrZero } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import type { FormTemplate, Order, ShopDetails } from '@/types/api';

import { orderParamRows } from './params';

type SheetKind = 'receipt' | 'work' | 'label';
type PageSize = 'A4' | 'A5' | 'A4 landscape';

const PAIR_STORAGE = 'poster.print.pair';
const LABELS_STORAGE = 'poster.print.labels';
/* сколько бирок печатать разом: на каждый рулон или пачку по одной.
   Плиткой 2 × 4 на A4 — восемь, больше на лист не влезает */
const LABEL_COUNTS = ['1', '2', '4', '6', '8'] as const;

function remembered<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const saved = localStorage.getItem(key);
    return allowed.includes(saved as T) ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
}

export function PrintOrderModal({ order, initialKind }: { order: Order; initialKind?: SheetKind }) {
  const can = useCan();
  const { data: catalog } = useCatalog();

  // Квитанция — про деньги, поэтому она есть только у того, кто их видит.
  // Остальным доступен наряд: там цен нет и быть не должно.
  // initialKind — с какого документа открыть (меню карточки на доске).
  const canReceipt = can('orders.price.view');
  const [kind, setKind] = useState<SheetKind>(() => {
    if (initialKind && (initialKind !== 'receipt' || canReceipt)) return initialKind;
    return canReceipt ? 'receipt' : 'work';
  });
  // две квитанции на листе: приёмке нужна своя копия, клиенту — своя
  const [pair, setPair] = useState(
    () => remembered<'yes' | 'no'>(PAIR_STORAGE, 'no', ['yes', 'no']) === 'yes',
  );
  const [labels, setLabels] = useState(() => Number(remembered(LABELS_STORAGE, '1', LABEL_COUNTS)));

  // Размер листа не выбирают здесь — его всё равно выбирают в окне печати
  // браузера, а наш переключатель только дублировал его. Мы лишь подставляем
  // разумное умолчание под документ: квитанция — A5, наряд и бирки — A4,
  // две квитанции — A4 поперёк. У бирок поля уже: с обычными 14 мм две
  // бирки по 90 мм на A4 не помещались рядом.
  const pageSize: PageSize = kind === 'receipt' ? (pair ? 'A4 landscape' : 'A5') : 'A4';
  usePageSize(pageSize, kind === 'label' ? '10mm' : '14mm');

  const switchKind = (next: SheetKind) => setKind(next);
  const chooseLabels = (next: number) => {
    setLabels(next);
    try {
      localStorage.setItem(LABELS_STORAGE, String(next));
    } catch {
      /* без памяти тоже работает */
    }
  };
  const togglePair = (next: boolean) => {
    setPair(next);
    try {
      localStorage.setItem(PAIR_STORAGE, next ? 'yes' : 'no');
    } catch {
      /* без памяти тоже работает */
    }
  };

  const template = catalog?.templates.find((t) => t.key === order.template_key);
  const design = useDesignInfo(order.id, can('design.view'));

  const receipt = <ReceiptSheet order={order} template={template} shop={catalog?.shop} />;

  return (
    <ModalShell
      // две квитанции рядом и плитка бирок в обычное окно не помещаются
      wide={(kind === 'receipt' && pair) || kind === 'label'}
      eyebrow={`Печать · ${order.number}`}
      title={kind === 'receipt' ? 'Квитанция клиенту' : kind === 'work' ? 'Наряд в цех' : 'Бирка на заказ'}
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
      <div className="print-switch">
        {canReceipt && (
          <button
            className={kind === 'receipt' ? 'active' : ''}
            type="button"
            onClick={() => switchKind('receipt')}
          >
            Квитанция клиенту
          </button>
        )}
        <button className={kind === 'work' ? 'active' : ''} type="button" onClick={() => switchKind('work')}>
          Наряд в цех
        </button>
        {/* бирка — на рулон или пачку: номер крупно, по нему ищут на полке */}
        <button
          className={kind === 'label' ? 'active' : ''}
          type="button"
          onClick={() => switchKind('label')}
        >
          Бирка
        </button>
      </div>

      <div className="print-opts">
        {kind === 'label' && (
          <div className="print-switch" role="group" aria-label="Сколько бирок">
            <span className="print-opts-label">Штук</span>
            {LABEL_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={labels === Number(n) ? 'active' : ''}
                onClick={() => chooseLabels(Number(n))}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        {kind === 'receipt' && (
          <label
            className="check"
            title="Две одинаковые квитанции рядом на листе A4 поперёк — приёмке и клиенту"
          >
            <input type="checkbox" checked={pair} onChange={(e) => togglePair(e.target.checked)} />
            Две на листе
          </label>
        )}
      </div>

      {kind === 'receipt' ? (
        pair ? (
          <div className="print-pair">
            {receipt}
            {receipt}
          </div>
        ) : (
          receipt
        )
      ) : kind === 'work' ? (
        <WorkSheet
          order={order}
          template={template}
          // без права на макеты строку не печатаем вовсе: «не приложен»
          // было бы неправдой — мы просто не знаем
          designFile={can('design.view') ? (design.data?.exists ? design.data.filename : '—') : ''}
        />
      ) : (
        <div className="print-labels">
          {Array.from({ length: labels }, (_, i) => (
            <LabelSheet key={i} order={order} shop={catalog?.shop} />
          ))}
        </div>
      )}

      <p className="print-hint">
        {kind === 'label'
          ? 'Бирка 90 × 55 мм, режется по пунктиру. Плиткой: на A4 помещается восемь (2 × 4), на A5 — три в столбик.'
          : `Так документ и напечатается. Лист ${pageSize === 'A4 landscape' ? 'A4 поперёк' : pageSize} подставлен в окно печати браузера — там же его можно сменить, как и поля.`}
      </p>
    </ModalShell>
  );
}

/* ---------------------------------------------------------- бирка */
/** Бирка на готовый заказ — клеится на рулон или пачку. Номер крупно: по
 *  нему ищут на полке; клиент и телефон — чтобы позвонить, не открывая
 *  карточку; что внутри — чтобы не разворачивать. Цен нет намеренно. */
function LabelSheet({ order, shop }: { order: Order; shop: ShopDetails | undefined }) {
  const client = [order.client_name, formatPhone(order.client_phone)].filter(Boolean).join(' · ');
  return (
    <div className="print-sheet print-label">
      <div className="pl-top">
        <b className="pl-num">{order.number}</b>
        {shop?.name && <span className="pl-shop">{shop.name}</span>}
      </div>
      {client && <div className="pl-client">{client}</div>}
      <div className="pl-work">
        {order.title}
        {order.summary ? ` · ${order.summary}` : ''}
      </div>
      <div className="pl-foot">
        <span>{order.quantity} шт</span>
        {order.due_date && <span>Готово {dateFullRu(order.due_date)}</span>}
        {order.manager && <span>Принял: {order.manager}</span>}
      </div>
    </div>
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
          <b>{[order.client_name, formatPhone(order.client_phone)].filter(Boolean).join(' · ')}</b>
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
        <span>
          {cancelled ? 'Заказ отменён, работа не выполняется.' : 'При получении назовите номер заказа.'}
        </span>
        <span className="ps-sign">Принял: ____________________</span>
      </div>

      <PrintedAt />
    </div>
  );
}

/** Деньги в квитанции. Главная строка — крупная рамка справа: с ней клиент
 *  придёт забирать заказ. Ноль в ней писать нельзя: «К доплате 0 ₽» человек
 *  читает мельком и переспрашивает, сколько же он должен. */
function MoneyBlock({ order }: { order: Order }) {
  const settled = !order.refunded && order.price > 0 && order.debt <= 0 && order.surplus <= 0;

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

/* ---------------------------------------------------------- наряд в цех */
export function WorkSheet({
  order,
  template,
  designFile,
}: {
  order: Order;
  template: FormTemplate | undefined;
  /** имя файла макета; «—» — макета нет; пусто — строку не показываем */
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

/* ---------------------------------------------------------- общие куски */
function ShopHead({ shop }: { shop: ShopDetails | undefined }) {
  const contacts = [shop?.phone, shop?.address, shop?.note].filter(Boolean).join(' · ');
  if (!shop?.name && !contacts && !shop?.logo) return null;
  return (
    <div className="ps-shop">
      {shop?.logo && <img className="ps-logo" src={shop.logo} alt="" />}
      <div className="ps-shop-text">
        {shop?.name && <b>{shop.name}</b>}
        {contacts && <span>{contacts}</span>}
      </div>
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
      Напечатано{' '}
      {new Date().toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </div>
  );
}
