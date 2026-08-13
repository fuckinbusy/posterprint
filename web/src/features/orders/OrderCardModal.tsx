/* Карточка заказа: состав, деньги, макет и история. */

import { useCatalog } from '@/api/catalog';
import { useOrder } from '@/api/orders';
import { useCan } from '@/app/AuthProvider';
import { ModalBackButton, ModalShell, useModal, useModalFrame } from '@/app/ModalProvider';
import { Empty, KeyValue, Loading, Section } from '@/components/ui';
import { PayBadge } from '@/features/board/payment';
import { useMoveStatus } from '@/features/board/useMoveStatus';
import { useStatuses } from '@/features/board/useStatuses';
import { ClientCardModal } from '@/features/clients/ClientCardModal';
import { DesignBlock } from '@/features/design/DesignBlock';
import { dateFullRu, dtRu, money, telHref } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import type { Order } from '@/types/api';

import { OrderFormModal } from './OrderFormModal';
import { useDeleteOrderFlow } from './useDeleteOrderFlow';

export function OrderCardModal({ orderId }: { orderId: number }) {
  const order = useOrder(orderId);

  if (order.isLoading || !order.data) {
    return (
      <ModalShell eyebrow="Заказ" title="Загружаю…">
        {order.isError ? <Empty>{(order.error as Error).message}</Empty> : <Loading />}
      </ModalShell>
    );
  }

  return <OrderCard order={order.data} />;
}

function OrderCard({ order }: { order: Order }) {
  const can = useCan();
  const modal = useModal();
  const frame = useModalFrame();
  const statuses = useStatuses();
  const moveStatus = useMoveStatus();
  const deleteOrder = useDeleteOrderFlow();
  const { data: catalog } = useCatalog();

  const template = catalog?.templates.find((t) => t.key === order.template_key);
  const allowed = statuses.allowedFrom(order.status);

  /* Состав заказа: показываем только заполненное — пустые поля в списке
   * из полутора десятков параметров только мешают читать.
   *
   * Ноль здесь — то же самое, что снятая галочка: «люверсы не нужны»,
   * «проклейки нет». Расчёт такое поле пропускает (см. contributes() в
   * app/pricing.py), а карточка показывала «Люверсы, шт: 0» рядом с
   * настоящими параметрами.
   *
   * Единицу измерения дописываем к размерам: «Ширина: 2» без «м» читается
   * как что угодно, а на карточке доски то же самое написано как «2×3 м». */
  const paramRows: [string, string][] = (template?.fields ?? [])
    .map((field) => ({ field, value: order.params?.[field.key] ?? null }))
    .filter(({ value }) => value !== undefined && value !== null && value !== '' && value !== false)
    .filter(({ value }) => !(typeof value === 'number' && value === 0) && value !== '0')
    .map(({ field, value }): [string, string] => {
      if (typeof value === 'boolean') return [field.label, 'да'];
      const isSize = ['width', 'height', 'length'].includes(field.pricing_role);
      return [field.label, isSize && field.unit ? `${value} ${field.unit}` : String(value)];
    });

  const workRows: [string, string][] = [
    ['Вид', template ? template.title : order.template_key],
    ['Количество', `${order.quantity} шт`],
    ...paramRows,
  ];
  if (order.due_date) workRows.push(['Срок', dateFullRu(order.due_date)]);
  if (order.manager) workRows.push(['Принял', order.manager]);

  const hasClient = order.client_name || order.client_phone || order.client_contact;

  return (
    <ModalShell
      eyebrow={`${order.number} · ${statuses.title(order.status)}`}
      title={order.title}
      foot={
        <>
          {can('orders.delete') && (
            <button className="btn btn-danger" type="button" onClick={() => void deleteOrder(order)}>
              Удалить
            </button>
          )}
          <div className="spacer" />
          <ModalBackButton />
          {can('orders.edit') && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() =>
                modal.replace(<OrderFormModal templateKey={order.template_key} order={order} />)
              }
            >
              Редактировать
            </button>
          )}
          <button className="btn btn-green" type="button" onClick={frame.closeAll}>
            Закрыть
          </button>
        </>
      }
    >
      <Section title="Статус">
        <div className="status-row">
          {statuses.statuses.map((status) => {
            const isCurrent = status.key === order.status;
            const enabled = isCurrent || (allowed.includes(status.key) && can('orders.status'));
            return (
              <button
                className={isCurrent ? 'status-pill current' : 'status-pill'}
                type="button"
                key={status.key}
                disabled={!enabled}
                style={isCurrent ? { color: status.color } : undefined}
                // здесь заказ уже открыт и статус выбирается осознанно —
                // подтверждение, как при перетаскивании, было бы лишним
                onClick={() => {
                  if (!isCurrent) void moveStatus(order, status.key, { confirm: false });
                }}
              >
                {status.title}
              </button>
            );
          })}
        </div>

        {order.status === 'cancelled' && order.cancel_reason && (
          <div className="cancel-note">
            <span>Причина отмены</span>
            {order.cancel_reason}
          </div>
        )}
      </Section>

      <Section title="Работа">
        <KeyValue rows={workRows} />
      </Section>

      {hasClient && (
        <Section title="Клиент">
          <KeyValue
            rows={[
              ...(order.client_name
                ? ([
                    [
                      'Кто',
                      order.client_id && can('clients.history') ? (
                        <a
                          href="#"
                          style={{ color: 'var(--green)', borderBottom: '1px dashed currentColor' }}
                          onClick={(e) => {
                            e.preventDefault();
                            modal.push(<ClientCardModal clientId={order.client_id as number} />, {
                              backLabel: '← К заказу',
                            });
                          }}
                        >
                          {order.client_name}
                        </a>
                      ) : (
                        order.client_name
                      ),
                    ],
                  ] as [string, React.ReactNode][])
                : []),
              ...(order.client_phone && can('clients.view')
                ? ([
                    [
                      'Телефон',
                      <a href={`tel:${telHref(order.client_phone)}`}>
                        {formatPhone(order.client_phone)}
                      </a>,
                    ],
                  ] as [string, React.ReactNode][])
                : []),
              ...(order.client_contact && can('clients.view')
                ? ([['Контакт', order.client_contact]] as [string, React.ReactNode][])
                : []),
            ]}
          />
        </Section>
      )}

      {can('orders.price.view') && (
        <Section title="Деньги">
          {order.payment !== 'unset' && order.payment !== 'hidden' && (
            <div className="pay-row">
              <PayBadge order={order} />
            </div>
          )}
          <MoneyBlock order={order} />
        </Section>
      )}

      {order.notes && (
        <Section title="Комментарий">
          <div style={{ fontSize: 14, color: '#c4c8c0', whiteSpace: 'pre-wrap' }}>{order.notes}</div>
        </Section>
      )}

      <DesignBlock orderId={order.id} />

      <Section title="История">
        <ul className="feed">
          {order.events.map((event) => (
            <li key={event.id}>
              {event.text}
              {event.author ? ` · ${event.author}` : ''}
              <time>{dtRu(event.created_at)}</time>
            </li>
          ))}
        </ul>
      </Section>
    </ModalShell>
  );
}

/** Деньги по заказу крупными числами.
 *
 *  Раньше это была строка словами («внесено 600 ₽ из 6 840 ₽, остаток
 *  6 240 ₽») приглушённым цветом, а под ней те же суммы ещё раз списком.
 *  Главное число — сколько клиент ещё должен — терялось и в предложении,
 *  и в повторе. Теперь каждая сумма отдельной плиткой, а долг выделен:
 *  при выдаче заказа именно его надо увидеть, не вчитываясь. */
function MoneyBlock({ order }: { order: Order }) {
  const cells: { label: string; value: string; tone?: string }[] = [
    { label: 'Стоимость', value: order.price ? money(order.price) : 'не указана' },
  ];

  if (order.payment === 'refunded') {
    cells.push({
      label: 'Вернули клиенту',
      value: money(order.prepaid) || money(order.price) || '—',
      tone: 'refund',
    });
  } else if (order.price) {
    if (order.prepaid) {
      cells.push({ label: 'Внесено', value: money(order.prepaid), tone: 'paid' });
    }
    if (order.debt) {
      cells.push({ label: 'Осталось доплатить', value: money(order.debt), tone: 'debt' });
    }
  }

  return (
    <div className="pay-split">
      {cells.map((cell) => (
        <div className={cell.tone ? `pay-cell ${cell.tone}` : 'pay-cell'} key={cell.label}>
          <span>{cell.label}</span>
          <b>{cell.value}</b>
        </div>
      ))}
    </div>
  );
}
