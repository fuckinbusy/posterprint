/* Единицы цены — один список на все места, где их выбирают.

   Единица живёт у позиции прайса, а не у раздела: в «Обработке» проклейка
   идёт за погонный метр, а люверсы за штуку, и раздел ради этого делить не
   надо. У раздела остаётся своя единица — она подставляется новым позициям
   как значение по умолчанию.

   На расчёт единица не влияет: способ счёта задаёт роль поля в виде работ.
   Это подпись для человека и материал для проверок в конструкторе. */

export interface PriceUnit {
  value: string;
  /** с расшифровкой — «₽/шт» само по себе понимают не все одинаково */
  label: string;
}

export const PRICE_UNITS: PriceUnit[] = [
  { value: '₽', label: '₽ — разово' },
  { value: '₽/шт', label: '₽/шт — за штуку' },
  { value: '₽/м²', label: '₽/м² — за квадратный метр' },
  { value: '₽/пог.м', label: '₽/пог.м — за погонный метр' },
  { value: '₽/м', label: '₽/м — за метр длины' },
  { value: '₽/лист', label: '₽/лист — за лист' },
  { value: '×', label: '× — коэффициент' },
];

/** Список для выпадашки: если у позиции единица, которой нет в справочнике
 *  (осталась от старых данных), добавляем её, чтобы не потерять при выборе. */
export function unitOptions(current: string): PriceUnit[] {
  if (!current || PRICE_UNITS.some((u) => u.value === current)) return PRICE_UNITS;
  return [...PRICE_UNITS, { value: current, label: current }];
}

/** Какие единицы реально встречаются в разделе — для подписи на плитке.
 *  Показывать одну на весь раздел больше нельзя: они могут быть разными. */
export function groupUnits(items: { unit: string }[], fallback: string): string {
  const found = [...new Set(items.map((i) => i.unit).filter(Boolean))];
  if (found.length === 0) return fallback;
  if (found.length <= 2) return found.join(' · ');
  return 'разные';
}
