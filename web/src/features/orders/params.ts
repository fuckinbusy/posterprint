/* Состав заказа человеческими строками: «Ширина: 2 м», «Проклейка: да».

   Одно место на всех, кто это показывает: карточка заказа и печатные формы.
   Правило «что считать заполненным» тонкое (см. ниже), и разъехавшиеся копии
   дали бы разный состав в карточке и в наряде — а по наряду работают. */

import type { FormTemplate, Order } from '@/types/api';

const SIZE_ROLES = ['width', 'height', 'length'];

/** Параметры заказа для показа: подпись и значение.
 *
 *  Пустое, «нет» и ноль не показываются. Ноль здесь — это не «нисколько», а
 *  «не нужно»: расчёт такое поле пропускает (см. contributes() в
 *  app/pricing.py), и в списке из полутора десятков полей нули только мешают
 *  читать. К размерам дописывается единица самого поля — «2» без «м» можно
 *  прочитать как что угодно. */
export function orderParamRows(
  template: FormTemplate | undefined,
  order: Order,
): [string, string][] {
  return (template?.fields ?? [])
    .map((field) => ({ field, value: order.params?.[field.key] ?? null }))
    .filter(({ value }) => value !== undefined && value !== null && value !== '' && value !== false)
    .filter(({ value }) => !(typeof value === 'number' && value === 0) && value !== '0')
    .map(({ field, value }): [string, string] => {
      if (typeof value === 'boolean') return [field.label, 'да'];
      const isSize = SIZE_ROLES.includes(field.pricing_role);
      return [field.label, isSize && field.unit ? `${value} ${field.unit}` : String(value)];
    });
}
