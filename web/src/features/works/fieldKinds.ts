/* Виды полей — то, как о них думает администратор.

   Каждый вид разворачивается в тройку (тип, источник, роль), которой
   оперирует движок расчёта. Так человеку не нужно знать про устройство
   системы: он отвечает на один вопрос «что это за поле», остальное
   подставляется само. */

import type { PriceGroup, PricingRole, WorkField } from '@/types/api';

export type FieldKindKey =
  | 'price_choice'
  | 'option_paid'
  | 'amount_paid'
  | 'width'
  | 'height'
  | 'length'
  | 'choice'
  | 'number_info'
  | 'note';

export interface FieldKind {
  key: FieldKindKey;
  title: string;
  hint: string;
  /** что проставить в поле при выборе этого вида */
  apply: Partial<WorkField>;
  /** по этим признакам вид узнаётся в уже сохранённом поле */
  match: (field: WorkField) => boolean;
  /** поле влияет на цену — показываем раздел прайса и способ расчёта */
  money?: boolean;
  /** поле привязано к одной позиции прайса, её нужно выбрать явно
   *  (у списка позицию задаёт сам выбор сотрудника) */
  pinsItem?: boolean;
}

export const FIELD_KINDS: FieldKind[] = [
  {
    key: 'price_choice',
    title: 'Выбор из прайса — влияет на цену',
    hint: 'Материал, бумага, формат. Сотрудник выбирает из списка, цена берётся из прайса.',
    apply: { type: 'select', source: 'price', pricing_role: 'per_unit' },
    match: (f) => f.type === 'select' && f.source === 'price',
    money: true,
  },
  {
    key: 'option_paid',
    title: 'Доплата галочкой',
    hint: 'Включил — прибавилось. Ламинация, люверсы, оклейка на объекте.',
    apply: { type: 'bool', source: 'price', pricing_role: 'per_order' },
    match: (f) => f.type === 'bool',
    money: true,
    pinsItem: true,
  },
  {
    key: 'width',
    title: 'Ширина изделия',
    hint: 'Нужна, чтобы считать площадь и периметр. Сотрудник вводит число.',
    apply: { type: 'number', source: 'list', pricing_role: 'width', price_group: '' },
    match: (f) => f.pricing_role === 'width',
  },
  {
    key: 'height',
    title: 'Высота изделия',
    hint: 'Вторая сторона для площади и периметра.',
    apply: { type: 'number', source: 'list', pricing_role: 'height', price_group: '' },
    match: (f) => f.pricing_role === 'height',
  },
  {
    key: 'length',
    title: 'Длина изделия',
    hint: 'Когда считаем по длине: резка кромки, кант, погонаж. Второе измерение не нужно.',
    apply: { type: 'number', source: 'list', pricing_role: 'length', price_group: '' },
    match: (f) => f.pricing_role === 'length',
  },
  {
    key: 'amount_paid',
    title: 'Платное количество',
    hint: 'Спрашиваем «сколько»: люверсы, отверстия, сгибы. Цена позиции умножается на введённое число. Ноль — значит не нужно, в расчёт не попадёт.',
    apply: { type: 'number', source: 'price', pricing_role: 'per_unit' },
    match: (f) => f.type === 'number' && f.source === 'price',
    money: true,
    pinsItem: true,
  },
  {
    key: 'choice',
    title: 'Выбор из своего списка — без цены',
    hint: 'Пометка для производства: тип изделия, вариант раскладки.',
    apply: { type: 'select', source: 'list', pricing_role: 'none', price_group: '' },
    match: (f) => f.type === 'select' && f.source === 'list',
  },
  {
    key: 'number_info',
    title: 'Число — без цены',
    hint: 'Количество сгибов, номер станка. Просто записывается в заказ.',
    apply: { type: 'number', source: 'list', pricing_role: 'none', price_group: '' },
    match: (f) => f.type === 'number',
  },
  {
    key: 'note',
    title: 'Текстовая заметка',
    hint: 'Свободная строка: что гравируем, номер макета.',
    apply: { type: 'text', source: 'list', pricing_role: 'none', price_group: '' },
    match: (f) => f.type === 'text',
  },
];

/* Как считать — показывается только у полей, влияющих на цену.
   kinds ограничивает, каким видам поля роль подходит. */
export const MONEY_ROLES: { key: PricingRole; title: string; kinds: FieldKindKey[] }[] = [
  // у платного количества всего два осмысленных способа: умножать введённое
  // число на тираж или считать его на весь заказ разом
  { key: 'per_order', title: 'Один раз за заказ', kinds: ['price_choice', 'option_paid', 'amount_paid'] },
  { key: 'per_unit', title: 'Умножить на количество', kinds: ['price_choice', 'option_paid', 'amount_paid'] },
  { key: 'per_sqm', title: 'Умножить на площадь', kinds: ['price_choice', 'option_paid'] },
  { key: 'per_m', title: 'Умножить на периметр', kinds: ['price_choice', 'option_paid'] },
  { key: 'per_length', title: 'Умножить на длину (пог. м)', kinds: ['price_choice', 'option_paid'] },
  { key: 'step_per_unit', title: 'Цена по ступеням тиража', kinds: ['price_choice'] },
  { key: 'multiplier', title: 'Коэффициент — умножит всё выше', kinds: ['price_choice', 'option_paid'] },
];

export const rolesFor = (kind: FieldKindKey) => MONEY_ROLES.filter((r) => r.kinds.includes(kind));

/* Роли, которые дают сумму. Считаются из MONEY_ROLES, а не перечисляются
   руками: иначе новая роль забудется в проверках — так уже случилось с
   «Умножить на длину». Коэффициент сюда не входит: сам по себе он ничего
   не добавляет, только множит то, что выше. */
export const PAYING_ROLES: PricingRole[] = MONEY_ROLES.map((r) => r.key).filter(
  (k) => k !== 'multiplier',
);

/** Роли, которым нужны поля-измерения, и какие именно. */
export const SIZE_REQUIREMENTS: Partial<Record<PricingRole, PricingRole[]>> = {
  per_sqm: ['width', 'height'],
  per_m: ['width', 'height'],
  per_length: ['length'],
};

export const SIZE_TITLES: Record<string, string> = {
  width: '«Ширина»',
  height: '«Высота»',
  length: '«Длина изделия»',
};

/* Единицы, которые ждёт каждая роль. Нужно, чтобы поймать несовпадение:
   раздел с ценой за м², умноженный на длину, даст бессмыслицу. */
const ROLE_UNITS: Partial<Record<PricingRole, { units: string[]; name: string }>> = {
  per_unit: { units: ['₽/шт', '₽'], name: 'за штуку' },
  step_per_unit: { units: ['₽/шт', '₽'], name: 'за штуку' },
  per_sqm: { units: ['₽/м²'], name: 'за квадратный метр' },
  per_m: { units: ['₽/пог.м', '₽/м'], name: 'за погонный метр' },
  per_length: { units: ['₽/пог.м', '₽/м'], name: 'за метр длины' },
  per_order: { units: ['₽'], name: 'разовую сумму' },
  multiplier: { units: ['×'], name: 'коэффициент' },
};

export const kindOf = (field: WorkField): FieldKindKey =>
  (FIELD_KINDS.find((k) => k.match(field)) ?? FIELD_KINDS[0]).key;

export const kindByKey = (key: FieldKindKey): FieldKind =>
  FIELD_KINDS.find((k) => k.key === key) ?? FIELD_KINDS[0];

/** Новое поле с настройками выбранного вида. Возвращает копию — состояние
 *  конструктора меняется только через setState, править на месте нельзя. */
export function applyKind(field: WorkField, kindKey: FieldKindKey): WorkField {
  const kind = kindByKey(kindKey);
  const next: WorkField = { ...field, ...kind.apply };

  if (!kind.money) {
    next.price_item = '';
    next.price_group = '';
  }
  // позицию прайса указывают только поля, привязанные к одной цене
  // (галочка, платное количество); у списка ставку даёт сам выбор
  if (!kind.pinsItem) next.price_item = '';
  next.default_value = '';
  return next;
}

/** Пустое поле, которое добавляется кнопкой «+ Добавить поле». */
export const emptyField = (): WorkField => ({
  key: '',
  label: '',
  type: 'select',
  source: 'price',
  price_group: '',
  options: [],
  default_value: '',
  pricing_role: 'per_unit',
  price_item: '',
  unit: 'мм',
  source_field: '',
  required: false,
});

/** Всё, что не так с полем — простым языком. */
export function fieldWarnings(
  field: WorkField,
  index: number,
  fields: WorkField[],
  groups: PriceGroup[],
): string[] {
  const kind = kindByKey(kindOf(field));
  const group = groups.find((g) => g.key === field.price_group);
  const items = group?.items ?? [];
  const warns: string[] = [];

  if (!field.label.trim()) warns.push('впишите подпись поля');

  if (kind.money) {
    if (!field.price_group) {
      warns.push('выберите раздел прайса, иначе цены не будет');
    } else if (items.length === 0) {
      warns.push('в разделе пока нет позиций — создайте хотя бы одну');
    } else {
      /* Единица теперь у каждой позиции своя, поэтому и сверяем по позициям.
       * Поле, привязанное к одной цене (галочка, счётчик), проверяем по ней;
       * список берёт любую позицию раздела, поэтому ругаемся, только если
       * НИ ОДНА не подходит — иначе смешанный раздел давал бы ложную
       * тревогу на каждом поле. */
      const expect = ROLE_UNITS[field.pricing_role];
      const related = kind.pinsItem
        ? items.filter((item) => item.item_key === field.price_item)
        : items;
      const units = [...new Set(related.map((item) => item.unit).filter(Boolean))];

      if (expect && units.length > 0 && !units.some((u) => expect.units.includes(u))) {
        const shown = units.join(', ');
        warns.push(
          kind.pinsItem
            ? `цена «${field.price_item}» указана ${shown}, а вы считаете ${expect.name} — проверьте, что выбрано верно`
            : `в разделе «${group?.title ?? ''}» цены ${shown}, а вы считаете ${expect.name} — проверьте, что выбрано верно`,
        );
      }

      // список не может считать по-разному разные варианты: роль одна на все
      if (!kind.pinsItem && units.length > 1) {
        warns.push(
          `в разделе цены в разных единицах (${units.join(', ')}), а список считает все варианты одинаково — возьмите галочки или отдельный раздел`,
        );
      }
    }
  }

  if (kind.pinsItem && field.price_group && items.length > 0 && !field.price_item) {
    warns.push('выберите позицию прайса');
  }
  if (field.pricing_role === 'multiplier' && index === 0) {
    warns.push('коэффициент стоит первым — умножать нечего, опустите его ниже');
  }
  if (
    field.pricing_role === 'step_per_unit' &&
    group &&
    !items.some((item) => /^\d+$/.test(item.item_key))
  ) {
    warns.push('в разделе нет позиций-чисел вида 100, 500 — ступени не сработают');
  }

  const needed = SIZE_REQUIREMENTS[field.pricing_role] ?? [];
  const missing = needed.filter((role) => !fields.some((f) => f.pricing_role === role));
  if (missing.length > 0) {
    warns.push(
      `добавьте ${missing.map((r) => SIZE_TITLES[r]).join(' и ')} — без них считать не по чему`,
    );
  }

  return warns;
}

/** «Ширина, мм» → «shirina_mm». Ключ нужен латиницей: он попадает в данные
 *  заказа и в API. */
export function translit(value: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return (
    (value || '')
      .toLowerCase()
      .split('')
      .map((ch) => map[ch] ?? ch)
      .join('')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'field'
  );
}

/** Проставляет ключи новым полям.
 *
 *  У существующих полей ключ НЕ меняется: под ним лежат значения во всех
 *  уже созданных заказах, и переименование подписи не должно осиротить
 *  данные. */
export function fillKeys(fields: WorkField[]): WorkField[] {
  const used = new Set(fields.map((f) => f.key).filter(Boolean));
  return fields.map((field, i) => {
    if (field.key) return field;
    const base = translit(field.label || `field_${i + 1}`);
    let key = base;
    let n = 2;
    while (used.has(key)) {
      key = `${base}_${n}`;
      n += 1;
    }
    used.add(key);
    return { ...field, key };
  });
}
