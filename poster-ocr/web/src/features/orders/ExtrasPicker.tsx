/* Дополнительные услуги к заказу: макет, вёрстка, замеры, монтаж.

   Раньше «Дизайн и услуги» были отдельным видом работ, и заказ «баннер плюс
   макет» оформляли двумя заказами. Теперь услуги — блок в форме любого
   заказа.

   Вид намеренно скупой: один список «Добавить услугу…» и короткие строки
   выбранного. Первый вариант раскладывал все услуги чипами — с десятью
   глаза разбегались, а с полусотней стало бы нечитаемо. В списке цена
   стоит подсказкой справа, выбранное убирается крестиком, у штучных услуг
   (вёрстка за страницу) есть количество. */

import { Select } from '@/components/Select';
import { CloseIcon } from '@/components/Icons';
import { money } from '@/lib/format';
import type { ExtraOption, OrderExtraIn } from '@/types/api';

interface ExtrasPickerProps {
  options: ExtraOption[];
  value: OrderExtraIn[];
  onChange: (value: OrderExtraIn[]) => void;
}

const perPiece = (option: ExtraOption): boolean => option.unit.includes('шт');

/** Название без скобок с диапазоном цен: «Простой макет (500–800 ₽)» →
 *  «Простой макет». Диапазон остаётся в подсказке списка и на странице прайса. */
const shortTitle = (title: string): string => title.replace(/\s*\([^)]*\)\s*$/, '').trim() || title;

export function ExtrasPicker({ options, value, onChange }: ExtrasPickerProps) {
  const byKey = new Map(options.map((o) => [o.key, o]));
  const chosen = new Set(value.map((e) => e.key));
  const total = value.reduce((acc, e) => acc + (byKey.get(e.key)?.price ?? 0) * e.qty, 0);

  const add = (key: string) => {
    if (!key || chosen.has(key)) return;
    onChange([...value, { key, qty: 1 }]);
  };
  const remove = (key: string) => onChange(value.filter((e) => e.key !== key));
  const setQty = (key: string, qty: number) =>
    onChange(value.map((e) => (e.key === key ? { ...e, qty: Math.max(qty, 1) } : e)));

  const available = options
    .filter((o) => !chosen.has(o.key))
    .map((o) => ({
      value: o.key,
      label: shortTitle(o.title),
      hint: perPiece(o) ? `${money(o.price)} / шт` : money(o.price),
    }));

  return (
    <div className="extras">
      <div className="extras-head">
        <span className="extras-title">Дополнительные услуги</span>
        {value.length > 0 ? (
          <span className="extras-total">
            {value.length} · <b>{money(total)}</b>
          </span>
        ) : (
          <span className="extras-hint">макет, замеры, монтаж — прибавятся к стоимости</span>
        )}
      </div>

      {value.length > 0 && (
        <div className="extras-list">
          {value.map((e) => {
            const option = byKey.get(e.key);
            if (!option) return null;
            return (
              <div className="extra-row" key={e.key}>
                <span className="extra-name" title={option.title}>
                  {shortTitle(option.title)}
                </span>
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
                  <span className="extra-qty" />
                )}
                <b className="extra-sum">{money(option.price * e.qty)}</b>
                <button
                  className="extra-remove"
                  type="button"
                  aria-label={`Убрать: ${option.title}`}
                  title="Убрать"
                  onClick={() => remove(e.key)}
                >
                  <CloseIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {available.length > 0 && (
        <div className="extras-add">
          <Select
            variant="compact"
            value=""
            placeholder={value.length ? '+ Ещё услугу…' : '+ Добавить услугу…'}
            options={available}
            onChange={add}
            aria-label="Добавить услугу"
          />
        </div>
      )}
    </div>
  );
}
