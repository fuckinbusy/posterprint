/* Форма заказа — создание и правка.

   Форма живёт в стеке окон и остаётся смонтированной, пока поверх неё
   открыто что-то другое. Поэтому заглянуть в карточку клиента и вернуться
   можно, ничего не потеряв: отдельный механизм черновика, который был в
   прежнем интерфейсе, больше не нужен. */

import { useState } from 'react';

import { useCatalog } from '@/api/catalog';
import { ExtrasPicker } from './ExtrasPicker';
import { useClient } from '@/api/clients';
import { estimatePrice, useCreateOrder, useUpdateOrder } from '@/api/orders';
import { uploadDesign } from '@/api/designs';
import { useAuth } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { ModalShell, useModal, useModalFrame, useUnsavedGuard } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Reg } from '@/components/Icons';
import { Select } from '@/components/Select';
import { Empty, Field, Section } from '@/components/ui';
import { useMoveStatus } from '@/features/board/useMoveStatus';
import { ClientCardModal } from '@/features/clients/ClientCardModal';
import { money, plural } from '@/lib/format';
import { formatPhone, phoneProblem, phoneProblemInline } from '@/lib/phone';
import type {
  Estimate,
  ExtraOption,
  FormTemplate,
  Order,
  OrderExtraIn,
  OrderParams,
  ParamValue,
  PayMethod,
} from '@/types/api';

import { ClientSearchField } from './ClientSearchField';
import { isDimension, neededDimensions } from './dimensions';
import { OrderCardModal } from './OrderCardModal';
import { OrderParamField } from './OrderParamField';
import { TemplatePickerModal } from './TemplatePickerModal';

interface OrderFormModalProps {
  templateKey: string;
  /** null — создаём новый заказ */
  order: Order | null;
}

interface FormState {
  title: string;
  quantity: string;
  params: OrderParams;
  /* доп. услуги: макет, замеры, монтаж — к любому заказу */
  extras: OrderExtraIn[];
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

/* carry — то, что уже ввели в форму до смены вида работ. Переносим всё,
   кроме параметров: их набор у нового вида другой. Совпавшие по ключу
   (материал, ширина, высота — они у видов работ общие) переезжают. */
function initialState(
  template: FormTemplate,
  order: Order | null,
  carry: FormState | null = null,
): FormState {
  const params: OrderParams = {};
  template.fields.forEach((field) => {
    let carried = carry?.params?.[field.key];
    // список у нового вида свой: «Баннер 440г» в поле «Материал» самоклейки
    // не вариант, а мусор, который расчёт потом не найдёт в прайсе
    if (field.type === 'select' && carried !== undefined && !field.options.includes(String(carried))) {
      carried = undefined;
    }
    const saved = order?.params?.[field.key];
    params[field.key] =
      carried !== undefined && carried !== null
        ? carried
        : saved !== undefined && saved !== null
          ? saved
          : field.default;
  });

  if (carry) return { ...carry, params, title: carry.title || template.title };

  return {
    title: order?.title || template.title,
    quantity: String(order?.quantity ?? 1),
    params,
    extras: (order?.extras ?? []).map((e) => ({ key: e.key, qty: e.qty })),
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

const PAY_METHOD_STORAGE = 'poster.pay.method';

export function OrderFormModal({ templateKey, order }: OrderFormModalProps) {
  const catalog = useCatalog();
  // вид работ можно сменить прямо в форме: ключ живёт здесь, форма под ним
  // пересоздаётся, а введённое переезжает через carry
  const [activeKey, setActiveKey] = useState(templateKey);
  const [carry, setCarry] = useState<FormState | null>(null);
  const template = catalog.data?.templates.find((t) => t.key === activeKey);

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
  return (
    <OrderForm
      extraOptions={catalog.data?.extras ?? []}
      key={`${activeKey}:${order?.id ?? 'new'}`}
      template={template}
      order={order}
      carry={carry}
      onSwitchTemplate={(key, state, oldTitle) => {
        // название, совпадающее с прежним видом работ, — автоматическое;
        // его заменит название нового вида
        setCarry({ ...state, title: state.title === oldTitle ? '' : state.title });
        setActiveKey(key);
      }}
    />
  );
}

function OrderForm({
  template,
  order,
  carry,
  extraOptions,
  onSwitchTemplate,
}: {
  template: FormTemplate;
  /** доп. услуги из раздела «Услуги» прайса — к любому заказу */
  extraOptions: ExtraOption[];
  order: Order | null;
  carry: FormState | null;
  onSwitchTemplate: (key: string, state: FormState, oldTitle: string) => void;
}) {
  const { session, can } = useAuth();
  const { toast, toastError } = useToast();
  const modal = useModal();
  const frame = useModalFrame();
  const askConfirm = useConfirm();

  const [form, setForm] = useState<FormState>(() => initialState(template, order, carry));
  const moveStatus = useMoveStatus();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Закрыть окно с введённым можно только через вопрос. Сравниваем со
  // снимком на момент открытия: пока ничего не трогали, вопросов нет.
  const [initialJson] = useState(() => JSON.stringify(initialState(template, order)));
  const markClean = useUnsavedGuard(JSON.stringify(form) !== initialJson || designFile !== null);
  const prepaidNow = Number(form.prepaid || 0);

  /* Деньги двинулись — на руках стало больше или меньше, чем было при
     открытии окна. Тогда спрашиваем, как приняли: наличными или переводом.
     В заказе это не хранится, уходит строкой в кассу за день. Последний
     выбор запоминаем: в смену обычно один и тот же способ. */
  const heldBefore = order && !order.refunded ? order.prepaid : 0;
  const heldNow = form.refunded ? 0 : prepaidNow;
  const moneyMoved = Math.round((heldNow - heldBefore) * 100) !== 0;
  const [payMethod, setPayMethod] = useState<PayMethod>(() => {
    try {
      return localStorage.getItem(PAY_METHOD_STORAGE) === 'transfer' ? 'transfer' : 'cash';
    } catch {
      return 'cash';
    }
  });
  const choosePayMethod = (value: PayMethod) => {
    setPayMethod(value);
    try {
      localStorage.setItem(PAY_METHOD_STORAGE, value);
    } catch {
      /* без памяти тоже работает */
    }
  };
  /* Ошибку по телефону показываем не на каждую набранную цифру, а когда
   * человек ушёл из поля или нажал «Сохранить»: иначе поле краснеет,
   * едва начав его заполнять. */
  const [phoneChecked, setPhoneChecked] = useState(false);
  const phoneError = phoneProblem(form.clientPhone);
  // пересчитывается на каждое изменение — галочка «Обрезка» тут же гасит
  // или возвращает поле длины
  const neededDims = neededDimensions(template.fields, form.params);

  const linked = useClient(form.clientId);
  // с какой карточкой была связь, пока имя или телефон не поправили руками
  const [unlinked, setUnlinked] = useState<string | null>(null);
  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setParam = (key: string, value: ParamValue) =>
    setForm((prev) => ({ ...prev, params: { ...prev.params, [key]: value } }));

  // Тираж меньше единицы — не заказ. Раньше пустое поле молча превращалось
  // в 1 и в расчёте, и при сохранении.
  const quantity = Number(form.quantity || 0);
  const quantityProblem = quantity >= 1 ? null : 'Укажите количество — хотя бы 1';

  const buildPayload = () => ({
    template_key: template.key,
    title: form.title.trim() || template.title,
    client_id: form.clientId,
    client_name: form.clientName.trim(),
    client_phone: form.clientPhone.trim(),
    client_contact: form.clientContact.trim(),
    quantity,
    params: form.params,
    extras: form.extras,
    due_date: form.dueDate || null,
    notes: form.notes.trim(),
    // без права на цену эти поля не отправляем вовсе: сервер их всё равно
    // не примет, а пустые значения затёрли бы то, что проставил старший
    ...(can('orders.price.edit')
      ? {
          price: Number(form.price || 0),
          prepaid: Number(form.prepaid || 0),
          refunded: form.refunded,
          ...(moneyMoved ? { pay_method: payMethod } : {}),
        }
      : {}),
  });

  const runEstimate = async () => {
    if (quantityProblem) {
      toast(quantityProblem);
      return;
    }
    try {
      const result = await estimatePrice(template.key, quantity, form.params, form.extras);
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
    if (quantityProblem) {
      toast(quantityProblem);
      return;
    }

    if (!(await confirmThin())) return;

    setSaving(true);
    try {
      if (order) {
        const updated = await updateOrder.mutateAsync({
          id: order.id,
          payload: { ...buildPayload(), template_key: template.key },
        });
        toast(`${updated.number} сохранён`);
        markClean();
        modal.replace(<OrderCardModal orderId={updated.id} />);

        /* Только что отметили возврат. Обычно это значит, что заказ не
           состоялся, — предлагаем отменить, но не настаиваем: бывает, что
           работа продолжается, а деньги вернули по другой причине. */
        if (form.refunded && !order.refunded && updated.status !== 'cancelled' && can('orders.status')) {
          const cancel = await askConfirm({
            eyebrow: updated.number,
            title: 'Перевести заказ в «Отменён»?',
            text: 'Деньги вернули — обычно это значит, что заказ не состоялся. Можно оставить как есть, если работа продолжается.',
            yes: 'Отменить заказ',
            no: 'Оставить',
          });
          if (cancel) void moveStatus(updated, 'cancelled', { confirm: false });
        }
        return;
      }

      const created = await createOrder.mutateAsync(buildPayload());
      toast(`${created.number} создан`);
      markClean();
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
            onClick={() => (order ? modal.replace(<OrderCardModal orderId={order.id} />) : frame.closeAll())}
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
        {/* Смена вида работ — одной строкой, чтобы не утяжелять форму.
            Введённое переезжает: клиент, деньги, срок и совпавшие параметры. */}
        {order && (
          <div className="form-kind">
            Вид работ: <b>{template.title}</b>
            {' · '}
            <button
              type="button"
              className="btn-link"
              onClick={() =>
                modal.push(
                  <TemplatePickerModal
                    onPick={(key) => {
                      modal.close();
                      if (key !== template.key) onSwitchTemplate(key, form, template.title);
                    }}
                  />,
                  { backLabel: '← К заказу' },
                )
              }
            >
              сменить
            </button>
          </div>
        )}
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
              if (form.clientId) setUnlinked(linked.data?.name || 'клиента');
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
              if (form.clientId) setUnlinked(linked.data?.name || 'клиента');
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

      {/* Правка телефона или имени снимает связь с карточкой — молча это
            выглядело как потеря. Говорим, что произошло и что будет дальше. */}
      {!form.clientId && unlinked && (
        <div className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
          Связь с карточкой «{unlinked}» снята. При сохранении карточку найдём по новому номеру или заведём
          новую — прежняя останется как была.
        </div>
      )}

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
                  onChange={(e) => {
                    if (!e.target.validity.badInput) set('price', e.target.value);
                  }}
                />
              </Field>
              <Field label="Внесено, ₽">
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={form.prepaid}
                  placeholder="0"
                  onChange={(e) => {
                    if (!e.target.validity.badInput) set('prepaid', e.target.value);
                  }}
                />
              </Field>
            </>
          )}
          <Field label="Срок сдачи">
            <input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        </div>

        {!order && (
          <div className="hint" style={{ marginTop: 10 }}>
            Заказ будет записан на профиль «{session?.name}».
          </div>
        )}

        {/* Услуги — не отдельный заказ, а строки в смете этого */}
        {extraOptions.length > 0 && (
          <ExtrasPicker
            options={extraOptions}
            value={form.extras}
            onChange={(extras) => set('extras', extras)}
          />
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
                {moneyMoved && (
                  <div className="pay-method">
                    <span>{heldNow < heldBefore ? 'Вернули' : 'Приняли'}</span>
                    <Select
                      variant="pill"
                      aria-label="Как приняли деньги"
                      value={payMethod}
                      options={[
                        { value: 'cash', label: 'наличными' },
                        { value: 'transfer', label: 'переводом' },
                      ]}
                      onChange={(v) => choosePayMethod(v as PayMethod)}
                    />
                  </div>
                )}
                {/* Возврат — только у существующего заказа: по заказу, который
                    ещё не создан, возвращать нечего. Отмеченный подсвечивается
                    красным — состояние отдаём классом, чтобы было видно в разметке. */}
                {order && (
                  <label
                    className={form.refunded ? 'check refunded' : 'check'}
                    title={prepaidNow > 0 ? undefined : 'Внесено 0 — возвращать нечего'}
                  >
                    <input
                      type="checkbox"
                      checked={form.refunded}
                      // возврат — это возврат внесённого; при нуле возвращать нечего
                      disabled={prepaidNow <= 0 && !form.refunded}
                      onChange={(e) => set('refunded', e.target.checked)}
                    />
                    Деньги вернули клиенту
                  </label>
                )}
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
                      <div className="calc-note">{estimate.note || 'Не хватает данных для расчёта'}</div>
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
                Необязательно. Файл прикрепится к заказу сразу после создания — ему нужен номер, а он
                присваивается при сохранении. Позже макет можно загрузить или заменить в карточке заказа.
              </>
            }
          >
            <input type="file" accept=".cdr" onChange={(e) => setDesignFile(e.target.files?.[0] ?? null)} />
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
function PaymentState({ price, prepaid, refunded }: { price: number; prepaid: number; refunded: boolean }) {
  if (refunded) {
    return <span className="money-state refund">Вернули {money(prepaid) || 'внесённое'}</span>;
  }
  // без цены судить об оплате рано
  if (!price) return null;
  if (prepaid > price) {
    return <span className="money-state overpaid">Переплата {money(prepaid - price)}</span>;
  }

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
