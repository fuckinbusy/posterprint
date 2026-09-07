/* Одна строка конструктора: что за поле и как оно влияет на цену. */

import { useModal } from '@/app/ModalProvider';
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '@/components/Icons';
import { Select } from '@/components/Select';
import { formatRate, plural } from '@/lib/format';

import { PricePickerModal } from './PricePickerModal';
import type { PriceGroup, PricingRole, SizeUnit, WorkField } from '@/types/api';

import {
  FIELD_KINDS,
  applyKind,
  fieldWarnings,
  kindByKey,
  kindOf,
  rolesFor,
  tierVariants,
  type FieldKindKey,
} from './fieldKinds';

/** Значение, по которому в списке узнаётся пункт «создать новое». */
export const CREATE_NEW = '__new__';

export type QuickMode = 'group' | 'item';

interface WorkFieldRowProps {
  field: WorkField;
  index: number;
  total: number;
  fields: WorkField[];
  groups: PriceGroup[];
  onChange: (next: WorkField) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onQuick: (index: number, mode: QuickMode) => void;
  /** встроенная форма создания раздела или позиции, если открыта */
  quickForm?: React.ReactNode;
}

const UNIT_TITLES: Record<SizeUnit, string> = {
  мм: 'миллиметры',
  см: 'сантиметры',
  м: 'метры',
};

export function WorkFieldRow({
  field,
  index,
  total,
  fields,
  groups,
  onChange,
  onMove,
  onRemove,
  onQuick,
  quickForm,
}: WorkFieldRowProps) {
  const modal = useModal();
  const kindKey = kindOf(field);
  const kind = kindByKey(kindKey);
  const group = groups.find((g) => g.key === field.price_group);
  const items = group?.items ?? [];
  const warns = fieldWarnings(field, index, fields, groups);

  const set = (patch: Partial<WorkField>) => onChange({ ...field, ...patch });

  /** Выбор из списка, где есть пункт «+ создать»: сам выбор не сохраняем,
   *  а открываем встроенную форму. */
  const pickOrCreate = (value: string, apply: (value: string) => void, mode: QuickMode) => {
    if (value === CREATE_NEW) onQuick(index, mode);
    else apply(value);
  };

  /* Раздел и позицию выбирают в окне: в выпадашке не видно ни цен, ни
     единиц, ни вложенности, а разделов со временем становится полсотни. */
  const groupParent = group?.parent_key ? groups.find((g) => g.key === group.parent_key) : undefined;
  const pickedItem = group?.items.find((i) => i.item_key === field.price_item);

  const openPicker = (mode: 'group' | 'item') =>
    modal.push(
      <PricePickerModal
        mode={mode}
        groups={groups}
        currentGroup={field.price_group}
        currentItem={field.price_item}
        onCreateGroup={() => onQuick(index, 'group')}
        onCreateItem={(groupKey) => {
          // форма создания позиции заводит её в выбранном разделе
          if (groupKey !== field.price_group) {
            set({ price_group: groupKey, price_item: '', default_value: '' });
          }
          onQuick(index, 'item');
        }}
        onPick={(groupKey, itemKey) => {
          const changedGroup = groupKey !== field.price_group;
          set({
            price_group: groupKey,
            // сменили раздел — прежние позиция и умолчание к нему не относятся
            price_item: itemKey ?? (changedGroup ? '' : field.price_item),
            default_value: changedGroup ? '' : field.default_value,
          });
        }}
      />,
      { backLabel: '← К виду работ' },
    );

  const priceRef = (
    <div className="wk-cell wide">
      <span>{kind.pinsItem ? 'Цена из прайса' : 'Варианты из прайса'}</span>
      <button
        className={field.price_group ? 'price-ref' : 'price-ref empty'}
        type="button"
        onClick={() => openPicker(kind.pinsItem ? 'item' : 'group')}
      >
        {field.price_group ? (
          <>
            <span className="path">
              {groupParent ? `${groupParent.title} › ` : ''}
              {group?.title ?? field.price_group}
            </span>
            {kind.pinsItem ? (
              <span className="item">
                {pickedItem ? (
                  <>
                    {pickedItem.title || pickedItem.item_key}
                    <em>{formatRate(pickedItem.value, pickedItem.unit)}</em>
                  </>
                ) : (
                  <em className="warn">позиция не выбрана</em>
                )}
              </span>
            ) : (
              <span className="item">
                {group
                  ? `${group.items.length} ${plural(group.items.length, 'позиция', 'позиции', 'позиций')}`
                  : ''}
              </span>
            )}
          </>
        ) : (
          <span className="path">Выбрать в прайсе…</span>
        )}
      </button>
    </div>
  );

  const roleSelect = (
    <label className="wk-cell">
      <span>Как считать</span>
      <Select
        value={field.pricing_role}
        options={rolesFor(kindKey).map((role) => ({ value: role.key, label: role.title }))}
        onChange={(v) => set({ pricing_role: v as PricingRole })}
      />
    </label>
  );

  const itemSelect = (name: 'price_item' | 'default_value', value: string, withValue: boolean) => (
    <label className="wk-cell">
      <span>{name === 'price_item' ? 'Позиция прайса' : 'Выбрано по умолчанию'}</span>
      <Select
        value={value}
        disabled={!field.price_group}
        placeholder={field.price_group ? '— выберите —' : '— сначала раздел —'}
        options={[
          { value: '', label: field.price_group ? '— выберите —' : '— сначала раздел —' },
          ...items.map((item) => ({
            value: item.item_key,
            label: item.title || item.item_key,
            hint: withValue ? String(item.value) : undefined,
          })),
          ...(field.price_group ? [{ value: CREATE_NEW, label: '+ Создать позицию…' }] : []),
        ]}
        onChange={(v) => pickOrCreate(v, (next) => set({ [name]: next }), 'item')}
      />
    </label>
  );

  const requiredCell = (
    <label className="wk-cell">
      <span>Обязательное</span>
      <span className="wk-toggle">
        <input
          type="checkbox"
          id={`req_${index}`}
          checked={field.required}
          onChange={(e) => set({ required: e.target.checked })}
        />
        <label htmlFor={`req_${index}`}>{field.required ? 'Да' : 'Нет'}</label>
      </span>
    </label>
  );

  /* Если в шаблоне несколько полей длины (погонаж материала и длина реза),
     денежное поле должно знать, по какому из них считать. */
  const lengthFields = fields.filter((f) => f.pricing_role === 'length');
  const dimCell =
    field.pricing_role === 'per_length' && lengthFields.length > 1 ? (
      <label className="wk-cell">
        <span>Считать по полю</span>
        <Select
          value={field.source_field}
          options={lengthFields.map((f, n) => ({ value: f.key, label: f.label || `длина ${n + 1}` }))}
          onChange={(v) => set({ source_field: v })}
        />
      </label>
    ) : null;

  let extra: React.ReactNode = null;

  if (kindKey === 'price_choice') {
    extra = (
      <>
        {priceRef}
        {roleSelect}
        {dimCell}
        {itemSelect('default_value', field.default_value, false)}
        {requiredCell}
      </>
    );
  } else if (kindKey === 'option_paid') {
    extra = (
      <>
        {priceRef}
        {roleSelect}
        {dimCell}
        <label className="wk-cell">
          <span>Включено сразу</span>
          <span className="wk-toggle">
            <input
              type="checkbox"
              id={`chk_${index}`}
              checked={Boolean(field.default_value)}
              onChange={(e) => set({ default_value: e.target.checked ? '1' : '' })}
            />
            <label htmlFor={`chk_${index}`}>{field.default_value ? 'Да' : 'Нет'}</label>
          </span>
        </label>
      </>
    );
  } else if (kindKey === 'amount_paid') {
    extra = (
      <>
        {priceRef}
        {roleSelect}
        <label className="wk-cell">
          <span>Сколько по умолчанию</span>
          <input
            type="number"
            step="any"
            min="0"
            value={field.default_value}
            placeholder="например 4"
            onChange={(e) => set({ default_value: e.target.value })}
          />
        </label>
        <div className="wk-unit-note">
          Сотрудник вводит количество, цена позиции умножается на него. Ноль — значит не нужно: поле не
          попадёт в расчёт.
        </div>
      </>
    );
  } else if (kindKey === 'tier_table' || kindKey === 'tier_key') {
    // варианты не набирают руками — они читаются из ключей раздела прайса:
    // «Крафт:4+0:100» → таблица «Крафт», уточнение «4+0»
    const tierField = fields.find((f) => f.pricing_role === 'step_per_unit');
    const groupKey =
      kindKey === 'tier_table' ? field.price_group : field.price_group || tierField?.price_group || '';
    const keys = groups.find((g) => g.key === groupKey)?.items.map((i) => i.item_key) ?? [];
    const depth =
      kindKey === 'tier_table'
        ? 0
        : 1 + fields.slice(0, index).filter((f) => f.pricing_role === 'step_key').length;
    const variants = tierVariants(keys, depth);
    extra = (
      <>
        {priceRef}
        <div className="wk-cell wide">
          <span>{kindKey === 'tier_table' ? 'Таблицы в разделе' : 'Варианты уточнения'}</span>
          <div className={variants.length ? 'wk-variants' : 'wk-variants empty'}>
            {variants.length
              ? variants.join(' · ')
              : groupKey
                ? 'в разделе нет ключей вида «Крафт:4+0:100» — добавьте таблицу в прайс'
                : 'сначала выберите раздел прайса'}
          </div>
        </div>
        <label className="wk-cell">
          <span>Выбрано по умолчанию</span>
          <Select
            value={field.default_value}
            options={[
              { value: '', label: field.required ? '— первый в списке —' : '— нет —' },
              ...variants.map((v) => ({ value: v, label: v })),
            ]}
            onChange={(v) => set({ default_value: v })}
          />
        </label>
        {requiredCell}
      </>
    );
  } else if (kindKey === 'choice') {
    const options = field.options ?? [];
    extra = (
      <>
        <label className="wk-cell wide">
          <span>Варианты через запятую</span>
          <input
            type="text"
            value={options.join(', ')}
            placeholder="Односторонняя, Двусторонняя"
            onChange={(e) =>
              set({
                options: e.target.value
                  .split(',')
                  .map((o) => o.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label className="wk-cell">
          <span>Выбрано по умолчанию</span>
          <Select
            value={field.default_value}
            options={[
              { value: '', label: field.required ? '— первый в списке —' : '— нет —' },
              ...options.map((option) => ({ value: option, label: option })),
            ]}
            onChange={(v) => set({ default_value: v })}
          />
        </label>
        {requiredCell}
      </>
    );
  } else if (kindKey === 'width' || kindKey === 'height' || kindKey === 'length') {
    const unit = (field.unit || 'мм') as SizeUnit;
    extra = (
      <>
        <label className="wk-cell">
          <span>В чём вводят</span>
          <Select
            value={unit}
            options={(['мм', 'см', 'м'] as SizeUnit[]).map((u) => ({ value: u, label: UNIT_TITLES[u] }))}
            onChange={(v) => set({ unit: v })}
          />
        </label>
        <label className="wk-cell wide">
          <span>Значение по умолчанию, {unit}</span>
          <input
            type="number"
            step="any"
            value={field.default_value}
            placeholder={`например ${unit === 'м' ? '2.5' : '300'}`}
            onChange={(e) => set({ default_value: e.target.value })}
          />
        </label>
        <div className="wk-unit-note">
          Это только для удобства ввода: сотрудник вводит в {unit}, а цена из прайса всегда считается за метр
          — пересчёт автоматический.
        </div>
      </>
    );
  } else if (kindKey === 'number_info') {
    extra = (
      <label className="wk-cell">
        <span>Значение по умолчанию</span>
        <input
          type="number"
          step="any"
          value={field.default_value}
          placeholder="например 2"
          onChange={(e) => set({ default_value: e.target.value })}
        />
      </label>
    );
  }

  return (
    <div className={warns.length > 0 ? 'wk-field has-warn' : 'wk-field'}>
      <div className="wk-field-top">
        <span className="wk-num">{index + 1}</span>
        <input
          className="wk-label"
          type="text"
          value={field.label}
          placeholder="Подпись поля — например «Материал»"
          onChange={(e) => set({ label: e.target.value })}
        />
        <button
          className="pr-act"
          type="button"
          title="Выше"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUpIcon />
        </button>
        <button
          className="pr-act"
          type="button"
          title="Ниже"
          disabled={index === total - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDownIcon />
        </button>
        <button className="pr-act del" type="button" title="Убрать" onClick={() => onRemove(index)}>
          <TrashIcon />
        </button>
      </div>

      <label className="wk-kind">
        <span>Что это за поле</span>
        <Select
          value={kindKey}
          options={FIELD_KINDS.map((item) => ({ value: item.key, label: item.title }))}
          onChange={(v) => onChange(applyKind(field, v as FieldKindKey))}
        />
      </label>
      <div className="wk-kind-hint">{kind.hint}</div>

      {extra && <div className="wk-field-body">{extra}</div>}
      {quickForm}

      {warns.length > 0 && (
        <div className="wk-warn">
          {warns.map((warn, i) => (
            <span key={i}>{warn}</span>
          ))}
        </div>
      )}
    </div>
  );
}
