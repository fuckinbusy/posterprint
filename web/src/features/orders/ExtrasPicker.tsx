/* Дополнительные услуги к заказу: макет, вёрстка, замеры, монтаж.

   Раньше «Дизайн и услуги» были отдельным видом работ, и заказ «баннер плюс
   макет» оформляли двумя заказами. Теперь услуги — блок в форме любого
   заказа: нажал на «Простой макет» — строка добавилась в смету и в
   квитанцию, нажал ещё раз — убралась. У штучных услуг (вёрстка за
   страницу, набор текста за лист) есть количество. */

import { money } from '@/lib/format';
import type { ExtraOption, OrderExtraIn } from '@/types/api';

interface ExtrasPickerProps {
  options: ExtraOption[];
  value: OrderExtraIn[];
  onChange: (value: OrderExtraIn[]) => void;
}

const perPiece = (option: ExtraOption): boolean => option.unit.includes('шт');

export function ExtrasPicker({ options, value, onChange }: ExtrasPickerProps) {
  const chosen = new Map(value.map((e) => [e.key, e]));
  const toggle = (option: ExtraOption) => {
    if (chosen.has(option.key)) onChange(value.filter((e) => e.key !== option.key));
    else onChange([...value, { key: option.key, qty: 1 }]);
  };
  const setQty = (key: string, qty: number) =>
    onChange(value.map((e) => (e.key === key ? { ...e, qty: Math.max(qty, 1) } : e)));

  const total = value.reduce((acc, e) => {
    const option = options.find((o) => o.key === e.key);
    return acc + (option ? option.price * e.qty : 0);
  }, 0);

  return (
    <div className="extras">
      <div className="extras-head">
        <span className="extras-title">Дополнительные услуги</span>
        <span className="extras-hint">Макет, замеры, монтаж — прибавляются к стоимости заказа</span>
      </div>
      <div className="extras-chips">
        {options.map((option) => {
          const on = chosen.has(option.key);
          return (
            <button
              key={option.key}
              className={on ? 'extra-chip on' : 'extra-chip'}
              type="button"
              aria-pressed={on}
              title={`${money(option.price)}${perPiece(option) ? ' за штуку' : ''}`}
              onClick={() => toggle(option)}
            >
              {option.title}
              <em>{money(option.price)}</em>
            </button>
          );
        })}
      </div>
      {value.length > 0 && (
        <div className="extras-list">
          {value.map((e) => {
            const option = options.find((o) => o.key === e.key);
            if (!option) return null;
            return (
              <div className="extra-row" key={e.key}>
                <span className="extra-name">{option.title}</span>
                {perPiece(option) ? (
                  <label className="extra-qty">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={e.qty}
                      aria-label={`Количество: ${option.title}`}
                      onChange={(ev) => setQty(e.key, Number(ev.target.value) || 1)}
                    />
                    <span>× {money(option.price)}</span>
                  </label>
                ) : (
                  <span className="extra-qty">{money(option.price)}</span>
                )}
                <b className="extra-sum">{money(option.price * e.qty)}</b>
              </div>
            );
          })}
          <div className="extra-row total">
            <span className="extra-name">Услуги всего</span>
            <b className="extra-sum">{money(total)}</b>
          </div>
        </div>
      )}
    </div>
  );
}
