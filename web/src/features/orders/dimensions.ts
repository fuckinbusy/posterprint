/* Какие поля-размеры нужны при текущем выборе в заказе.

   Зеркало функций contributes() и needed_dimensions() из app/pricing.py.
   Держать копию приходится: форма пересчитывает это на каждое нажатие
   галочки, и ходить за ответом на сервер по десять раз в секунду нельзя.

   ВАЖНО при правках: правило должно совпадать с серверным. Если здесь поле
   погаснет, а сервер его потребует, сотрудник получит «Укажите: Длина» и не
   сможет ничего сделать — поле-то выключено. Меняете одно — меняйте оба. */

import type { FormField, OrderParams, PricingRole } from '@/types/api';

const DIMENSION_ROLES: PricingRole[] = ['width', 'height', 'length'];

export const isDimension = (field: FormField): boolean =>
  DIMENSION_ROLES.includes(field.pricing_role);

/** Участвует ли поле в цене при этих значениях заказа. */
export function contributes(field: FormField, params: OrderParams): boolean {
  // step_key лишь уточняет таблицу тиража — сам ничего не стоит
  if (field.pricing_role === 'none' || field.pricing_role === 'step_key' || isDimension(field)) return false;

  const value = params[field.key] ?? field.default;
  if (field.type === 'bool') return Boolean(value);
  if (field.type === 'number') return Number(value ?? 0) !== 0;
  return value !== null && value !== undefined && value !== '' && value !== 'Нет';
}

/** Ключи полей-размеров, без которых цену не посчитать. */
export function neededDimensions(fields: FormField[], params: OrderParams): Set<string> {
  const paying = fields.filter((field) => contributes(field, params));
  const roles = new Set(paying.map((field) => field.pricing_role));

  const dimensions = fields.filter(isDimension);
  const first = new Map<PricingRole, string>();
  dimensions.forEach((field) => {
    if (!first.has(field.pricing_role)) first.set(field.pricing_role, field.key);
  });

  const needed = new Set<string>();

  // площадь и периметр строятся на обеих сторонах
  if (roles.has('per_sqm') || roles.has('per_m')) {
    (['width', 'height'] as PricingRole[]).forEach((role) => {
      const key = first.get(role);
      if (key) needed.add(key);
    });
  }

  // у расчёта по длине каждое поле может смотреть на свою длину
  paying
    .filter((field) => field.pricing_role === 'per_length')
    .forEach((field) => {
      const source = field.source_field || '';
      const key = dimensions.some((d) => d.key === source) ? source : (first.get('length') ?? '');
      if (key) needed.add(key);
    });

  return needed;
}
