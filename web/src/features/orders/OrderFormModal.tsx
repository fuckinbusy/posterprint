/* Форма заказа — создание и правка.

   Форма живёт в стеке окон и остаётся смонтированной, пока поверх неё
   открыто что-то другое. Поэтому заглянуть в карточку клиента и вернуться
   можно, ничего не потеряв: отдельный механизм черновика, который был в
   прежнем интерфейсе, больше не нужен. */

import { useState } from 'react';

import { useCatalog } from '@/api/catalog';
import { useClient } from '@/api/clients';
import { estimatePrice, useCreateOrder, useUpdateOrder } from '@/api/orders';
import { uploadDesign } from '@/api/designs';
import { useAuth } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { ModalShell, useModal, useModalFrame } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Reg } from '@/components/Icons';
import { Empty, Field, Section } from '@/components/ui';
import { ClientCardModal } from '@/features/clients/ClientCardModal';
import { money, plural } from '@/lib/format';
import { formatPhone, phoneProblem, phoneProblemInline } from '@/lib/phone';
import type { Estimate, FormTemplate, Order, OrderParams, ParamValue } from '@/types/api';

import { ClientSearchField } from './ClientSearchField';
import { isDimension, neededDimensions } from './dimensions';
import { OrderCardModal } from './OrderCardModal';
import { OrderParamField } from './OrderParamField';

interface OrderFormModalProps {
  templateKey: string;
  /** null — создаём новый заказ */
  order: Order | null;
}

interface FormState {
  title: string;
  quantity: string;
  params: OrderParams;
  clientId: number | null;
  clientName: string;
  clientPhone: string;
  clientContact: string;
  /* деньги держим строками: иначе очищенное поле превращается в 0
   * и «цена не указана» становится «0 ₽» */
  price: string;
  prepaid: string;
  refunded: boolean;
  dueDate: string;
  notes: string;
}

function initialState(template: FormTemplate, order: Order | null): FormState {
  const params: OrderParams = {};
  template.fields.forEach((field) => {
    const saved = order?.params?.[field.key];
    params[field.key] = saved !== undefined && saved !== null ? saved : field.default;
  });

  return {
    title: order?.title || template.title,
    quantity: String(order?.quantity ?? 1),
    params,
    clientId: order?.client_id ?? null,
    clientName: order?.client_name ?? '',
    clientPhone: order?.client_phone ?? '',
    clientContact: order?.client_contact ?? '',
    price: order?.price ? String(order.price) : '',
    prepaid: order?.prepaid ? String(order.prepaid) : '',
    refunded: order?.refunded ?? false,
    dueDate: order?.due_date ?? '',
    notes: order?.notes ?? '',
  };
}

export function OrderFormModal({ templateKey, order }: OrderFormModalProps) {
  const catalog = useCatalog();
  const template = catalog.data?.templates.find((t) => t.key === templateKey);

  if (!template) {
    return (
      <ModalShell eyebrow="Заказ" title="Вид работ">
        <Empty>
          {catalog.isLoading
            ? 'Загружаю…'
            : 'Вид работ не найден — возможно, его удалили. Обновите страницу.'}
        </Empty>
      </ModalShell>
    );
  }

  // ключ пересоздаёт форму, если сменился вид работ или заказ
  return <OrderForm key={`${templateKey}:${order?.id ?? 'new'}`} template={template} order={order} />;
}

function OrderForm({ template, order }: { template: FormTemplate; order: Order | null }) {
  const { session, can } = useAuth();
  const { toast, toastError } = useToast();
  const modal = useModal();
  const frame = useModalFrame();
  const askConfirm = useConfirm();

  const [form, setForm] = useState<FormState>(() => initialState(template, order));
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  /* Ошибку по телефону показываем не на каждую набранную цифру, а когда
   * человек ушёл из поля или нажал «Сохранить»: иначе поле краснеет,
   * едва начав его заполнять. */
  const [phoneChecked, setPhoneChecked] = useState(false);
  const phoneError = phoneProblem(form.clientPhone);
  // пересчитывается на каждое изменение — галочка «Обрезка» тут же гасит
  // или возвращает поле длины
  const neededDims = neededDimensions(template.fields, form.params);

  const linked = useClient(form.clientId);
  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setParam = (key: string, value: ParamValue) =>
    setForm((prev) => ({ ...prev, params: { ...prev.params, [key]: value } }));

  const quantity = Math.max(Number(form.quantity || 0), 1);

  const buildPayload = () => ({
    template_key: template.key,
    title: form.title.trim() || template.title,
    client_id: form.clientId,
    client_name: form.clientName.trim(),
    client_phone: form.clientPhone.trim(),
    client_contact: form.clientContact.trim(),
    quantity,
    params: form.params,
    due_date: form.dueDate || null,
    notes: form.notes.trim(),
    // без права на цену эти поля не отправляем вовсе: сервер их всё равно
    // не примет, а пустые значения затёрли бы то, что проставил старший
    ...(can('orders.price.edit')
      ? {
          price: Number(form.price || 0),
          prepaid: Number(form.prepaid || 0),
          refunded: form.refunded,
        }
      : {}),
  });

  const runEstimate = async () => {
    try {
      const result = await estimatePrice(template.key, quantity, form.params);
      setEstimate(result);
      if (result.price !== null) set('price', String(Math.round(result.price)));
    } catch (e) {
      toastError(e);
    }
  };

  /* Заказ без контактов и без срока сервер принимает — и правильно делает:
     бывает работа «для себя» или человек ждёт у стойки. Но чаще это просто
     забыли заполнить, а обнаруживается это, когда работа готова и звонить
     некому. Поэтому не запрещаем, а переспрашиваем — и только при создании:
     в правке уже существующего заказа это был бы вопрос на каждое сохранение.

     Возвращает false, если человек передумал сохранять. */
  const confirmThin = async (): Promise<boolean> => {
    if (order) return true;

    const noClient = !form.clientName.trim() && !form.clientPhone.trim() && !form.clientContact.trim();
    const noDue = !form.dueDate;
    if (!noClient && !noDue) return true;

    const missing = [noClient && 'без клиента', noDue && 'без срока сдачи'].filter(Boolean);
    return askConfirm({
      eyebrow: 'Новый заказ',
      title: `Создать ${missing.join(' и ')}?`,
      text: (
        <>
          {noClient && <>Ни имени, ни телефона — когда работа будет готова, позвонить будет некому. </>}
          {noDue && <>Без срока заказ не попадёт ни в «просрочено», ни в «сдать сегодня».</>}
        </>
      ),
      note: 'Всё это можно дописать позже в карточке заказа.',
      yes: 'Всё равно создать',
    });
  };

  const save = async () => {
    // По телефону сервер узнаёт постоянного клиента. Пропустить опечатку —
    // значит завести ему вторую карточку, и история заказов разъедется.
    if (phoneError) {
      setPhoneChecked(true);
      toast(`Проверьте телефон: ${phoneProblemInline(phoneError)}`);
      return;
    }

    if (!(await confirmThin())) return;

    setSaving(true);
    try {
      if (order) {
        const updated = await updateOrder.mutateAsync({ id: order.id, payload: buildPayload() });
        toast(`${updated.number} сохранён`);
        modal.replace(<OrderCardModal orderId={updated.id} />);
        return;
      }

      const created = await createOrder.mutateAsync(buildPayload());
      toast(`${created.number} создан`);
      frame.closeAll();

      // Макет отправляем отдельным запросом: файлу нужно имя по номеру
      // заказа, а номер присваивается только при создании.
      if (designFile) await sendDesign(created, designFile);
    } catch (e) {
      toastError(e);
      setSaving(false);
    }
  };

  const sendDesign = async (created: Order, file: File) => {
    if (!/\.cdr$/i.test(file.name)) {
      toast('Макет не прикреплён: принимаются только файлы .cdr');
      return;
    }
    try {
      const info = await uploadDesign(created.id, file);
      toast(
        info.has_preview
          ? `Макет прикреплён к ${created.number}`
          : `Макет прикреплён к ${created.number}, но превью в нём нет`,
      );
    } catch (e) {
      // заказ уже создан — говорим правду про макет, но не делаем вид,
      // что пропало всё
      toastError(`Заказ создан, но макет не загрузился: ${(e as Error).message}`);
    }
  };

  const openClientCard = () => {
    if (!form.clientId) return;
    modal.push(<ClientCardModal clientId={form.clientId} />, { backLabel: '← К заказу' });
  };

  const linkedParts: string[] = [];
  if (linked.data) {
    linkedParts.push(
      linked.data.orders_count
        ? `${linked.data.orders_count} ${plural(linked.data.orders_count, 'заказ', 'заказа', 'заказов')}`
        : 'новая карточка',
    );
    if (linked.data.active_count) linkedParts.push(`${linked.data.active_count} в работе`);
    if (linked.data.total_sum) linkedParts.push(`на ${money(linked.data.total_sum)}`);
  }

  return (
    <ModalShell
      eyebrow={order ? `${order.number} · редактирование` : 'Новый заказ'}
      title={template.title}
      foot={
        <>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() =>
              order ? modal.replace(<OrderCardModal orderId={order.id} />) : frame.closeAll()
            }
          >
            Отмена
          </button>
          <div className="spacer" />
          <button className="btn btn-green" type="button" disabled={saving} onClick={save}>
            {order ? 'Сохранить' : 'Создать заказ'}
          </button>
        </>
      }
    >
      <Section title="Работа">
        <div className="grid">
          <Field label="Название заказа">
            <input
              type="text"
              value={form.title}
              placeholder={template.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field label={template.quantity_label}>
            <input
              type="number"
              min="1"
              step="1"
              value={form.quantity}
              onChange={(e) => set('quantity', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid" style={{ marginTop: 13 }}>
          {template.fields.map((field) => (
            <OrderParamField
              key={field.key}
              field={field}
              value={form.params[field.key] ?? null}
              // размер, который никому не нужен при текущем выборе, гасим:
              // раньше пустую длину нельзя было оставить, и печать без
              // обрезки не считалась вовсе
              inactive={isDimension(field) && !neededDims.has(field.key)}
              onChange={(value) => setParam(field.key, value)}
            />
          ))}
        </div>
      </Section>

      <Section title="Клиент">
        <div className="grid">
          <ClientSearchField
            label="Имя или компания"
            value={form.clientName}
            placeholder="Начните вводить — найдём"
            enabled={can('clients.search')}
            onChange={(value) => {
              // руками правят имя — значит это уже не выбранная карточка
              setForm((prev) => ({ ...prev, clientName: value, clientId: null }));
            }}
            onPick={(client) =>
              setForm((prev) => ({
                ...prev,
                clientId: client.id,
                clientName: client.name || '',
                clientPhone: client.phone || '',
                clientContact: client.contact || prev.clientContact,
              }))
            }
          />
          <ClientSearchField
            label="Телефон"
            type="tel"
            value={form.clientPhone}
            placeholder="+7 ___ ___ __ __"
            enabled={can('clients.search')}
            error={phoneChecked ? phoneError : null}
            onBlur={() => {
              setPhoneChecked(true);
              // причёсываем к единому виду: в базе телефон лежит строкой,
              // и разнобой в записи мешает и поиску, и глазам
              setForm((prev) => ({ ...prev, clientPhone: formatPhone(prev.clientPhone) }));
            }}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, clientPhone: value, clientId: null }));
            }}
            onPick={(client) =>
              setForm((prev) => ({
                ...prev,
                clientId: client.id,
                clientName: client.name || '',
                clientPhone: client.phone || '',
                clientContact: client.contact || prev.clientContact,
              }))
            }
          />
        </div>
        <div className="grid one" style={{ marginTop: 13 }}>
          <Field label="Почта, телеграм или как удобнее">
            <input
              type="text"
              value={form.clientContact}
              placeholder="Необязательно"
              onChange={(e) => set('clientContact', e.target.value)}
            />
          </Field>
        </div>

        {form.clientId && linked.data && (
          <div className="client-linked">
            <Reg />
            <span>Клиент из справочника · {linkedParts.join(' · ')}</span>
            {can('clients.history') && (
              <button type="button" onClick={openClientCard}>
                карточка
              </button>
            )}
            <button type="button" onClick={() => set('clientId', null)}>
              отвязать
            </button>
          </div>
        )}
      </Section>

      <Section title={can('orders.price.edit') ? 'Деньги и срок' : 'Срок'}>
        <div className="grid">
          {can('orders.price.edit') && (
            <>
              <Field label="Стоимость, ₽">
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={form.price}
                  placeholder="0"
                  onChange={(e) => set('price', e.target.value)}
                />
              </Field>
              <Field label="Внесено, ₽">
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={form.prepaid}
                  placeholder="0"
                  onChange={(e) => set('prepaid', e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Срок сдачи">
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
            />
          </Field>
        </div>

        {!order && (
          <div className="hint" style={{ marginTop: 10 }}>
            Заказ будет записан на профиль «{session?.name}».
          </div>
        )}


        {/* Деньги одним блоком: быстрые действия, состояние оплаты и расчёт
            по прайсу раньше были тремя не связанными между собой кусками. */}
        {(can('orders.price.edit') || can('orders.estimate')) && (
          <div className="money-box">
            {can('orders.price.edit') && (
              <div className="money-quick">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    if (!Number(form.price || 0)) {
                      toast('Сначала укажите стоимость');
                      return;
                    }
                    setForm((prev) => ({ ...prev, prepaid: prev.price, refunded: false }));
                  }}
                >
                  Оплачен полностью
                </button>
                {/* Отмеченный возврат подсвечивается красным — состояние
                    отдаём классом, чтобы оно было видно прямо в разметке. */}
                <label className={form.refunded ? 'check refunded' : 'check'}>
                  <input
                    type="checkbox"
                    checked={form.refunded}
                    onChange={(e) => set('refunded', e.target.checked)}
                  />
                  Деньги вернули клиенту
                </label>
                <PaymentState
                  price={Number(form.price || 0)}
                  prepaid={Number(form.prepaid || 0)}
                  refunded={form.refunded}
                />
              </div>
            )}

            {can('orders.estimate') && (
              <div className="calc">
                <div className="calc-head">
                  <div className="calc-title">
                    <b>Подсказка по цене</b>
                    <span>Посчитаем по прайсу — сумму можно поправить</span>
                  </div>
                  <button className="btn btn-ghost" type="button" onClick={runEstimate}>
                    Рассчитать
                  </button>
                </div>

                {estimate && (
                  <div className="calc-lines show">
                    {estimate.price === null ? (
                      <div className="calc-note">
                        {estimate.note || 'Не хватает данных для расчёта'}
                      </div>
                    ) : (
                      <>
                        {estimate.breakdown.map((line, i) => (
                          <div className="calc-line" key={i}>
                            <span>{line.label}</span>
                            <span>{money(line.amount)}</span>
                          </div>
                        ))}
                        <div className="calc-line total">
                          <span>Итого по прайсу</span>
                          <span>{money(estimate.price)}</span>
                        </div>
                        {estimate.note && <div className="calc-note">{estimate.note}</div>}
                        <div className="calc-note">
                          Сумма подставлена в поле «Стоимость» — поправьте, если договорились иначе.
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Section>

      {!order && can('design.upload') && (
        <Section title="Макет">
          <Field
            hint={
              <>
                Необязательно. Файл прикрепится к заказу сразу после создания — ему нужен номер, а
                он присваивается при сохранении. Позже макет можно загрузить или заменить в
                карточке заказа.
              </>
            }
          >
            <input
              type="file"
              accept=".cdr"
              onChange={(e) => setDesignFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </Section>
      )}

      <Section title="Дополнительно">
        <Field label="Комментарий к заказу">
          <textarea
            value={form.notes}
            placeholder="Пожелания, ссылка на макет, что уточнить"
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>
      </Section>
    </ModalShell>
  );
}

/** Что с оплатой прямо сейчас — считается, пока человек печатает.
 *
 *  Раньше это выяснялось только после сохранения, в карточке заказа. Здесь
 *  та же логика, что и на сервере (payment_state в routers/orders.py):
 *  внесли столько же или больше — оплачен, часть — остаток, ничего — к оплате. */
function PaymentState({
  price,
  prepaid,
  refunded,
}: {
  price: number;
  prepaid: number;
  refunded: boolean;
}) {
  if (refunded) return <span className="money-state refund">Деньги вернули</span>;
  // без цены судить об оплате рано
  if (!price) return null;

  if (prepaid >= price) {
    return (
      <span className="money-state paid">
        Оплачен<b>{money(price)}</b>
      </span>
    );
  }
  if (prepaid > 0) {
    return (
      <span className="money-state debt">
        Остаток<b>{money(price - prepaid)}</b>
      </span>
    );
  }
  return (
    <span className="money-state">
      К оплате<b>{money(price)}</b>
    </span>
  );
}
