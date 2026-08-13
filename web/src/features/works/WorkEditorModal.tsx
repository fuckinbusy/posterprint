/* Конструктор вида работ.

   Здесь администратор собирает форму заказа: какие поля спрашивать и как
   каждое влияет на цену. Поля-списки берут варианты из разделов прайса —
   добавили материал в прайс, он появился в форме заказа.

   Порядок полей значим: коэффициент умножает только то, что стоит выше
   него по списку. */

import { useState } from 'react';

import { usePrices } from '@/api/prices';
import { previewTemplate, useSaveTemplate } from '@/api/templates';
import { useConfirm } from '@/app/ConfirmProvider';
import { ModalShell, useModalFrame } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { TemplateIcon } from '@/components/Icons';
import { Empty, Field, Section } from '@/components/ui';
import { money } from '@/lib/format';
import type {
  Estimate,
  OrderParams,
  WorkField,
  WorkTemplate,
  WorkTemplatePayload,
} from '@/types/api';

import { QuickPriceForm } from './QuickPriceForm';
import { WorkFieldRow, type QuickMode } from './WorkFieldRow';
import {
  PAYING_ROLES,
  SIZE_REQUIREMENTS,
  SIZE_TITLES,
  emptyField,
  fillKeys,
  kindByKey,
  kindOf,
  rolesFor,
} from './fieldKinds';

const ICONS = ['printer', 'doc', 'blade', 'roll', 'card'];
const SIZE_ROLES = ['width', 'height', 'length'];

/** Вид работ → тело запроса. Сервер не принимает id полей и служебные поля. */
export function toPayload(template: WorkTemplate): WorkTemplatePayload {
  return {
    title: template.title,
    short: template.short,
    hint: template.hint,
    icon: template.icon,
    quantity_label: template.quantity_label,
    active: template.active,
    fields: template.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      source: f.source,
      price_group: f.price_group,
      options: f.options,
      default_value: String(f.default_value ?? ''),
      pricing_role: f.pricing_role,
      price_item: f.price_item,
      unit: f.unit || 'мм',
      source_field: f.source_field || '',
      required: f.required,
    })),
  };
}

/** Роль, которая не может работать при текущем типе и источнике, снимается.
 *
 *  Иначе она «залипает» невидимкой и выдаёт предупреждения, которых человек
 *  не может объяснить: в списке способов расчёта такого пункта просто нет. */
function normalizeRoles(fields: WorkField[]): WorkField[] {
  return fields.map((field) => {
    const kind = kindByKey(kindOf(field));
    const allowed = kind.money
      ? rolesFor(kind.key).map((r) => r.key)
      : [kind.apply.pricing_role].filter(Boolean);
    if (allowed.includes(field.pricing_role)) return field;
    return { ...field, pricing_role: allowed[0] ?? 'none' };
  });
}

interface QuickState {
  index: number;
  mode: QuickMode;
}

export function WorkEditorModal({ template }: { template: WorkTemplate | null }) {
  const frame = useModalFrame();
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();
  const prices = usePrices();
  const saveTemplate = useSaveTemplate();

  const isNew = !template;
  const [draft, setDraft] = useState<WorkTemplatePayload>(() =>
    template
      ? { ...toPayload(template), fields: normalizeRoles(toPayload(template).fields) }
      : {
          title: '',
          short: '',
          hint: '',
          icon: 'printer',
          quantity_label: 'Количество, шт',
          active: true,
          fields: [],
        },
  );

  const [quick, setQuick] = useState<QuickState | null>(null);
  const [testQty, setTestQty] = useState('1');
  const [testSizes, setTestSizes] = useState<Record<number, string>>({});
  const [testResult, setTestResult] = useState<Estimate | string | null>(null);
  const [saving, setSaving] = useState(false);

  // показываем все разделы, включая только что созданные пустые: иначе
  // новый раздел пропадал бы из списка сразу после создания
  const groups = (prices.data?.groups ?? []).filter((g) => g.id !== null);

  const setField = (index: number, next: WorkField) =>
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f, i) => (i === index ? next : f)),
    }));

  const moveField = (from: number, to: number) =>
    setDraft((prev) => {
      if (to < 0 || to >= prev.fields.length) return prev;
      const fields = [...prev.fields];
      const [item] = fields.splice(from, 1);
      fields.splice(to, 0, item);
      return { ...prev, fields };
    });

  const removeField = (index: number) => {
    setDraft((prev) => ({ ...prev, fields: prev.fields.filter((_, i) => i !== index) }));
    setQuick(null);
  };

  /* ---------------------------------------------------- проверка расчёта */
  const runTest = async () => {
    const fields = fillKeys(draft.fields);
    setDraft((prev) => ({ ...prev, fields }));

    const params: OrderParams = {};
    fields.forEach((field, i) => {
      if (SIZE_ROLES.includes(field.pricing_role)) {
        params[field.key] = Number(testSizes[i] ?? defaultTestSize(field));
      } else if (field.type === 'bool') {
        params[field.key] = Boolean(field.default_value);
      } else if (field.type === 'number') {
        params[field.key] = Number(field.default_value || 0);
      } else {
        params[field.key] = field.default_value || field.options?.[0] || '';
      }
    });

    const quantity = Math.max(Number(testQty || 1), 1);
    try {
      setTestResult(await previewTemplate({ quantity, params, fields }));
    } catch (e) {
      setTestResult((e as Error).message);
    }
  };

  /* ---------------------------------------------------- сохранение */
  const save = async () => {
    const fields = fillKeys(draft.fields);
    const title = draft.title.trim();

    if (!title) {
      toast('Укажите название вида работ');
      return;
    }

    // не даём сохранить набор, который не будет работать
    const problems: string[] = [];
    const named = (field: WorkField, i: number) => `«${field.label.trim() || `поле ${i + 1}`}»`;

    fields.forEach((field, i) => {
      const kind = kindByKey(kindOf(field));
      if (!field.label.trim()) problems.push(`${named(field, i)}: не заполнена подпись`);
      if (kind.money && !field.price_group) {
        problems.push(`${named(field, i)}: не выбран раздел прайса`);
      }
      if (kind.pinsItem && field.price_group && !field.price_item) {
        problems.push(`${named(field, i)}: не выбрана позиция прайса`);
      }
      if (field.type === 'select' && field.source === 'list' && (field.options ?? []).length === 0) {
        problems.push(`${named(field, i)}: не заданы варианты`);
      }
    });

    // у каждой роли свои требования к полям размеров
    const present = new Set(fields.map((f) => f.pricing_role));
    Object.entries(SIZE_REQUIREMENTS).forEach(([role, needed]) => {
      if (!present.has(role as WorkField['pricing_role'])) return;
      const missing = (needed ?? []).filter((r) => !present.has(r));
      if (missing.length === 0) return;
      problems.push(`не хватает полей: ${missing.map((r) => SIZE_TITLES[r]).join(' и ')}`);
    });

    if (problems.length > 0) {
      toast(problems[0]);
      return;
    }

    const paying = fields.filter((f) => PAYING_ROLES.includes(f.pricing_role));
    if (paying.length === 0) {
      const ok = await askConfirm({
        eyebrow: 'Виды работ',
        title: 'Сохранить без расчёта цены?',
        text: 'Ни одно поле не влияет на цену — кнопка «Рассчитать» в заказе ничего не покажет, стоимость придётся ставить руками.',
        note: 'Так тоже можно: не для всех работ есть прайс.',
        yes: 'Сохранить',
        no: 'Вернуться',
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      await saveTemplate.mutateAsync({
        id: template?.id ?? null,
        payload: { ...draft, title, fields },
      });
      toast(isNew ? `«${title}» создан` : 'Сохранено');
      frame.close();
    } catch (e) {
      toastError(e);
      setSaving(false);
    }
  };

  /* ---------------------------------------------------- разметка */
  const sizeFields = draft.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => SIZE_ROLES.includes(field.pricing_role));

  return (
    <ModalShell
      wide
      eyebrow={isNew ? 'Новый вид работ' : `Настройка · ${template.title}`}
      title={isNew ? 'Вид работ' : template.title}
      foot={
        <>
          <button className="btn btn-ghost" type="button" onClick={frame.close}>
            Отмена
          </button>
          <div className="spacer" />
          <button className="btn btn-green" type="button" disabled={saving} onClick={save}>
            {isNew ? 'Создать' : 'Сохранить'}
          </button>
        </>
      }
    >
      <Section title="Вид работ">
        <div className="grid">
          <Field label="Название">
            <input
              type="text"
              value={draft.title}
              placeholder="Например: Лазерная гравировка"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <Field label="Метка на карточке">
            <input
              type="text"
              value={draft.short}
              placeholder="Коротко: Гравировка"
              onChange={(e) => setDraft({ ...draft, short: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid one" style={{ marginTop: 13 }}>
          <Field label="Описание">
            <input
              type="text"
              value={draft.hint}
              placeholder="Что это за работа"
              onChange={(e) => setDraft({ ...draft, hint: e.target.value })}
            />
          </Field>
        </div>
        <div className="field" style={{ marginTop: 13 }}>
          <label>Иконка</label>
          <div className="icon-row">
            {ICONS.map((icon) => (
              <button
                className={draft.icon === icon ? 'icon-pick on' : 'icon-pick'}
                type="button"
                key={icon}
                onClick={() => setDraft({ ...draft, icon })}
              >
                <TemplateIcon name={icon} />
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Поля формы заказа">
        <p className="pr-hint">
          Это то, что сотрудник заполнит при создании заказа. Поля считаются сверху вниз, поэтому
          коэффициент умножает только то, что стоит выше него.
        </p>

        <div className="wk-fields">
          <QuantityRow
            label={draft.quantity_label}
            fields={draft.fields}
            onChange={(quantity_label) => setDraft({ ...draft, quantity_label })}
          />

          {draft.fields.length === 0 ? (
            <Empty>Полей пока нет. Начните с материала — он даст цену.</Empty>
          ) : (
            draft.fields.map((field, index) => (
              <WorkFieldRow
                key={index}
                field={field}
                index={index}
                total={draft.fields.length}
                fields={draft.fields}
                groups={groups}
                onChange={(next) => setField(index, next)}
                onMove={moveField}
                onRemove={removeField}
                onQuick={(i, mode) => setQuick({ index: i, mode })}
                quickForm={
                  quick?.index === index ? (
                    <QuickPriceForm
                      mode={quick.mode}
                      group={groups.find((g) => g.key === field.price_group)}
                      onCancel={() => setQuick(null)}
                      onCreated={(key) => {
                        setQuick(null);
                        if (quick.mode === 'group') {
                          setField(index, {
                            ...field,
                            price_group: key,
                            price_item: '',
                            default_value: '',
                          });
                        } else if (field.type === 'bool') {
                          setField(index, { ...field, price_item: key });
                        } else {
                          setField(index, { ...field, default_value: key });
                        }
                      }}
                    />
                  ) : null
                }
              />
            ))
          )}
        </div>

        <button
          className="btn btn-ghost"
          type="button"
          style={{ marginTop: 12 }}
          onClick={() => setDraft({ ...draft, fields: [...draft.fields, emptyField()] })}
        >
          + Добавить поле
        </button>
      </Section>

      <Section title="Проверка расчёта">
        <p className="pr-hint">
          Посчитайте пример по текущим настройкам — сразу видно, работает ли цена. Вид работ для
          этого сохранять не нужно.
        </p>
        <div className="wk-test">
          <label className="wk-cell">
            <span>Количество</span>
            <input
              type="number"
              min="1"
              value={testQty}
              onChange={(e) => setTestQty(e.target.value)}
            />
          </label>
          {sizeFields.map(({ field, index }) => (
            <label className="wk-cell" key={index}>
              <span>
                {field.label || 'размер'}, {field.unit || 'мм'}
              </span>
              <input
                type="number"
                step="any"
                value={testSizes[index] ?? defaultTestSize(field)}
                onChange={(e) => setTestSizes({ ...testSizes, [index]: e.target.value })}
              />
            </label>
          ))}
          <button className="btn btn-ghost" type="button" onClick={runTest}>
            Посчитать пример
          </button>
        </div>

        {testResult !== null && (
          <div className="calc-lines show">
            {typeof testResult === 'string' ? (
              <div className="calc-note">{testResult}</div>
            ) : testResult.price === null ? (
              <div className="calc-note">
                {testResult.note || 'Цена не считается — проверьте поля выше'}
              </div>
            ) : (
              <>
                {testResult.breakdown.map((line, i) => (
                  <div className="calc-line" key={i}>
                    <span>{line.label}</span>
                    <span>{money(line.amount)}</span>
                  </div>
                ))}
                <div className="calc-line total">
                  <span>Итого по прайсу</span>
                  <span>{money(testResult.price)}</span>
                </div>
                {testResult.note && <div className="calc-note">{testResult.note}</div>}
                <div className="calc-note">Остальные поля взяты со значениями «по умолчанию».</div>
              </>
            )}
          </div>
        )}
      </Section>
    </ModalShell>
  );
}

/** Значение размера для примера: своё умолчание, иначе метр в нужных единицах. */
const defaultTestSize = (field: WorkField): string =>
  field.default_value || ((field.unit || 'мм') === 'м' ? '1' : '1000');

/** Количество — встроенное поле, оно есть у любого вида работ.
 *
 *  Показываем его в общем списке: иначе администратор не видит, что оно
 *  участвует в цене, и заводит второе поле с тем же смыслом. */
function QuantityRow({
  label,
  fields,
  onChange,
}: {
  label: string;
  fields: WorkField[];
  onChange: (value: string) => void;
}) {
  const hasLength = fields.some((f) => f.pricing_role === 'length');
  const perLength = fields.some((f) => f.pricing_role === 'per_length');

  return (
    <div className="wk-field wk-field-fixed">
      <div className="wk-field-top">
        <span className="wk-num">№</span>
        <input
          className="wk-label"
          type="text"
          value={label}
          placeholder="Количество, шт"
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="wk-fixed-tag">всегда есть</span>
      </div>
      <div className="wk-kind-hint">
        {hasLength || perLength ? (
          <>
            Сейчас длина считается отдельным полем, значит количество — это{' '}
            <b>число изделий</b>. Например 3 детали по 2.5 м.
          </>
        ) : (
          <>
            Умножает всё, что считается «за единицу». Если продаёте погонным метром, напишите здесь
            «Погонных метров», поставьте цену в ₽/м и роль «Умножить на количество» — отдельное поле
            длины тогда не нужно.
          </>
        )}
      </div>
    </div>
  );
}
