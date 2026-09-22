/* Карточка клиента: контакты, счётчики и история заказов. */

import { useState } from 'react';

import {
  CLIENT_ORDERS_PAGE,
  useClient,
  useClientOrders,
  useDeleteClient,
  useUpdateClient,
} from '@/api/clients';
import { useCan } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { ModalBackButton, ModalShell, useModal, useModalFrame, useUnsavedGuard } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Pager } from '@/components/Pager';
import { Empty, Field, KeyValue, Loading, Section } from '@/components/ui';
import { useStatuses } from '@/features/board/useStatuses';
import { OrderCardModal } from '@/features/orders/OrderCardModal';
import { dateRu, initials, money, moneyOrZero, plural, telHref } from '@/lib/format';
import { formatPhone, phoneProblem, phoneProblemInline } from '@/lib/phone';
import type { Client } from '@/types/api';

import { MergeClientModal } from './MergeClientModal';

export function ClientCardModal({ clientId }: { clientId: number }) {
  const client = useClient(clientId);

  if (!client.data) {
    return (
      <ModalShell eyebrow="Клиент" title="Загружаю…">
        {client.isError ? <Empty>{(client.error as Error).message}</Empty> : <Loading />}
      </ModalShell>
    );
  }

  return <ClientCard client={client.data} />;
}

function ClientCard({ client }: { client: Client }) {
  const can = useCan();
  const modal = useModal();
  const frame = useModalFrame();
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();
  const statuses = useStatuses();

  const editable = can('clients.edit');
  const [offset, setOffset] = useState(0);
  const [phoneChecked, setPhoneChecked] = useState(false);
  const [form, setForm] = useState({
    name: client.name,
    phone: client.phone,
    contact: client.contact,
    notes: client.notes,
  });

  const [initialJson] = useState(() =>
    JSON.stringify({ name: client.name, phone: client.phone, contact: client.contact, notes: client.notes }),
  );
  const markClean = useUnsavedGuard(JSON.stringify(form) !== initialJson);

  const history = useClientOrders(client.id, offset, can('clients.history'));
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();

  const save = async () => {
    const problem = phoneProblem(form.phone);
    if (problem) {
      setPhoneChecked(true);
      toast(`Проверьте телефон: ${phoneProblemInline(problem)}`);
      return;
    }
    try {
      await updateClient.mutateAsync({
        id: client.id,
        payload: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          contact: form.contact.trim(),
          notes: form.notes.trim(),
        },
      });
      toast('Карточка сохранена');
      markClean();
      // если пришли сюда из заказа — возвращаемся туда, иначе закрываем
      if (frame.hasParent) frame.close();
      else frame.closeAll();
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    const ok = await askConfirm({
      eyebrow: 'Клиенты',
      title: 'Удалить карточку?',
      text: [
        <>
          Карточка <b>{client.name || 'Без имени'}</b> будет удалена.
        </>,
        'Заказы останутся — в них имя и телефон хранятся отдельно.',
      ],
      note: 'При следующем заказе на этот телефон карточка заведётся заново.',
      yes: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    try {
      await deleteClient.mutateAsync(client.id);
      toast('Карточка удалена');
      markClean();
      frame.closeAll();
    } catch (e) {
      toastError(e);
    }
  };

  const orders = history.data?.items ?? [];

  return (
    <ModalShell
      eyebrow="Клиент"
      title={client.name || 'Без имени'}
      foot={
        <>
          {editable && (
            <button className="btn btn-danger" type="button" onClick={remove}>
              Удалить
            </button>
          )}
          {editable && (
            <button
              className="btn btn-ghost"
              type="button"
              title="Влить эту карточку в другую: заказы перейдут туда"
              onClick={() =>
                modal.push(<MergeClientModal client={client} />, { backLabel: '← К карточке' })
              }
            >
              Объединить…
            </button>
          )}
          <div className="spacer" />
          <ModalBackButton />
          {editable ? (
            <button className="btn btn-green" type="button" onClick={save}>
              Сохранить
            </button>
          ) : (
            <button className="btn btn-green" type="button" onClick={frame.closeAll}>
              Закрыть
            </button>
          )}
        </>
      }
    >
      <div className="cl-card-top">
        <span className="cl-av big">{initials(client.name)}</span>
        <div className="cl-card-stats">
          <div className="cl-stat">
            <b>{client.orders_count}</b>
            <span>{plural(client.orders_count, 'заказ', 'заказа', 'заказов')}</span>
          </div>
          {client.active_count > 0 && (
            <div className="cl-stat accent">
              <b>{client.active_count}</b>
              <span>в работе</span>
            </div>
          )}
          {client.total_sum !== null && (
            <div className="cl-stat">
              <b>{moneyOrZero(client.total_sum)}</b>
              <span>всего</span>
            </div>
          )}
          <div className="cl-stat">
            <b>{client.last_order_at ? dateRu(String(client.last_order_at).slice(0, 10)) : '—'}</b>
            <span>последний</span>
          </div>
        </div>
      </div>

      <Section title="Контакты">
        {editable ? (
          <>
            <div className="grid">
              <Field label="Имя или компания">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field
                label="Телефон"
                error={phoneChecked ? phoneProblem(form.phone) : null}
              >
                <input
                  type="tel"
                  className={phoneChecked && phoneProblem(form.phone) ? 'bad' : undefined}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  onBlur={() => {
                    setPhoneChecked(true);
                    setForm((prev) => ({ ...prev, phone: formatPhone(prev.phone) }));
                  }}
                />
              </Field>
            </div>
            <div className="grid one" style={{ marginTop: 13 }}>
              <Field label="Почта, телеграм">
                <input
                  type="text"
                  value={form.contact}
                  placeholder="Необязательно"
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid one" style={{ marginTop: 13 }}>
              <Field label="Заметка">
                <textarea
                  value={form.notes}
                  placeholder="Особенности работы с клиентом, скидки, предпочтения"
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
            </div>
          </>
        ) : (
          <KeyValue
            rows={[
              ...(client.phone
                ? ([
                    [
                      'Телефон',
                      <a href={`tel:${telHref(client.phone)}`}>{formatPhone(client.phone)}</a>,
                    ],
                  ] as [string, React.ReactNode][])
                : []),
              ...(client.contact ? ([['Контакт', client.contact]] as [string, React.ReactNode][]) : []),
              ...(client.notes
                ? ([
                    ['Заметка', <span style={{ whiteSpace: 'pre-wrap' }}>{client.notes}</span>],
                  ] as [string, React.ReactNode][])
                : []),
              ...(!client.phone && !client.contact
                ? ([['Контакты', 'не указаны']] as [string, React.ReactNode][])
                : []),
            ]}
          />
        )}
      </Section>

      {can('clients.history') && (
        <Section
          title={
            <>
              История заказов
              {history.data && history.data.total > orders.length && (
                <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                  {' '}
                  — всего {history.data.total}
                </span>
              )}
            </>
          }
        >
          {history.isLoading && <Loading />}
          {history.data && orders.length === 0 && <Empty>Заказов пока нет</Empty>}

          {orders.length > 0 && (
            <ul className="cl-orders">
              {orders.map((row) => (
                <li
                  key={row.id}
                  onClick={() =>
                    modal.push(<OrderCardModal orderId={row.id} />, { backLabel: '← К клиенту' })
                  }
                >
                  <span className="num">{row.number}</span>
                  <span className="ttl">
                    {row.title}
                    {row.summary && <em>{row.summary}</em>}
                  </span>
                  <span className="st" style={{ color: statuses.color(row.status) }}>
                    {statuses.title(row.status)}
                  </span>
                  <span className="pr">{row.price !== null ? money(row.price) || '—' : ''}</span>
                </li>
              ))}
            </ul>
          )}

          {history.data && (
            <Pager
              total={history.data.total}
              limit={CLIENT_ORDERS_PAGE}
              offset={history.data.offset}
              onGo={setOffset}
            />
          )}
        </Section>
      )}
    </ModalShell>
  );
}
