/* Форматирование чисел, дат и слов. Всё, что показывается человеку. */

const RUB = new Intl.NumberFormat('ru-RU');

/** 12500 → «12 500 ₽». Ноль и пустое дают пустую строку — так задумано:
 *  «0 ₽» в карточке заказа читается как «бесплатно», а не «цена не указана». */
export const money = (value: number | null | undefined): string =>
  value ? `${RUB.format(Math.round(value))} ₽` : '';

/** То же, но ноль показывается явно — для итогов и сводок. */
export const moneyOrZero = (value: number | null | undefined): string => money(value) || '0 ₽';

/** «2026-08-11» → «11.08» */
export const dateRu = (iso: string | null | undefined): string =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    : '';

/** «2026-08-11» → «11.08.2026» */
export const dateFullRu = (iso: string | null | undefined): string =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU') : '';

/** Момент времени → «11.08 14:30» */
export const dtRu = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/** Момент времени с годом — для файлов макетов. */
export const dtFullRu = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

export const todayISO = (): string => {
  // toISOString() отдаёт UTC: в Москве после 21:00 это уже завтра,
  // и заказ на сегодня подсвечивался бы просроченным
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

/** 1 заказ, 2 заказа, 5 заказов */
export const plural = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

export const initials = (name: string | null | undefined): string =>
  (name || '?').trim().charAt(0).toUpperCase();

/** Номер вида ЗК-2026-000042 → 2026000042, чтобы сортировать числом.
 *  Год учитывается первым, поэтому заказы 2025 года всегда идут раньше
 *  заказов 2026-го, даже если порядковый номер у них больше. */
export function orderNumberKey(number: string): number {
  const m = String(number || '').match(/(\d{4})\D+(\d+)\s*$/);
  if (!m) return 0;
  return Number(m[1]) * 1e9 + Number(m[2]);
}

export function fileSize(bytes: number): string {
  if (!bytes) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/** «700 ₽/м²» — значение с единицей измерения раздела прайса. */
export function formatRate(value: number, unit: string): string {
  const num = RUB.format(value);
  if (!unit) return num;
  if (unit === '×') return `× ${num}`;
  return `${num} ${unit}`;
}

/** Телефон для ссылки tel: — только цифры и плюс. */
export const telHref = (phone: string): string => (phone || '').replace(/[^\d+]/g, '');
