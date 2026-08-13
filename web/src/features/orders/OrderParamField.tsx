/* Одно поле формы заказа. Как его показать — решает вид работ.

   Варианты для списков уже подставлены сервером из прайса: добавили материал
   в прайс — он появился здесь сам. */

import { useId } from 'react';

import type { FormField, ParamValue } from '@/types/api';

interface OrderParamFieldProps {
  field: FormField;
  value: ParamValue;
  /** поле ни на что не влияет при текущем выборе — гасим, но не прячем */
  inactive?: boolean;
  onChange: (value: ParamValue) => void;
}

/** Роли, у которых значение — это размер: им показываем единицу измерения. */
const SIZE_ROLES = ['width', 'height', 'length'];

export function OrderParamField({ field, value, inactive, onChange }: OrderParamFieldProps) {
  const id = useId();

  /* Гасим, а не убираем: исчезающие и появляющиеся поля дёргают форму, и
   * непонятно, куда делось то, что было. Погашенное поле сохраняет
   * введённое — вернули галочку, значение на месте. */
  const hint = inactive ? (
    <span className="hint">Не участвует в расчёте при текущем выборе</span>
  ) : null;

  if (field.type === 'select') {
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}</label>
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {/* необязательное поле можно оставить пустым: «без ламинации» */}
          {!field.required && <option value="">— нет —</option>}
          {field.options.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'number') {
    // у полей размера показываем единицу — иначе легко ввести метры вместо
    // миллиметров и получить цену в тысячу раз меньше
    const isSize = SIZE_ROLES.includes(field.pricing_role);
    const unit = isSize ? field.unit || 'мм' : '';
    return (
      <div className={inactive ? 'field inactive' : 'field'}>
        <label htmlFor={id}>{field.label}</label>
        <div className="num-with-unit">
          <input
            id={id}
            type="number"
            min="0"
            step={unit === 'м' ? 'any' : '1'}
            disabled={inactive}
            value={String(value ?? 0)}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
          {unit && <span className="unit">{unit}</span>}
        </div>
        {hint}
      </div>
    );
  }

  if (field.type === 'bool') {
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <input id={id} type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
