/* Телефон клиента: проверка и приведение к единому виду.

   Зачем строго. По телефону сервер узнаёт постоянного клиента и подшивает
   заказ к его карточке (app/clients.py, normalize_phone). Опечатка в одной
   цифре — и вместо истории заказов заводится вторая карточка того же
   человека. Дубли потом расходятся по заказам, и склеить их обратно уже
   нечем: правильного номера в базе нет ни у одной из них.

   Правила приведения повторяют серверные: 8 → 7, десять цифр → плюс код 7.
   Иначе фронт показал бы «номер в порядке», а сервер посчитал бы его
   другим номером. */

/** Только цифры. */
export const phoneDigits = (raw: string): string => (raw || '').replace(/\D/g, '');

/** К виду 7XXXXXXXXXX — так же, как это делает сервер. */
export function normalizePhone(raw: string): string {
  const trimmed = (raw || '').trim();
  let digits = phoneDigits(trimmed);
  // иностранный номер (через «+», не 7/8) российским правилам не подчиняется —
  // иначе десятизначный «+49 151 …» получал бы семёрку спереди
  if (trimmed.startsWith('+') && digits && digits[0] !== '7' && digits[0] !== '8') return digits;
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

/** Иностранный номер — тот, что записан через «+» и начинается не с 7 и не с 8. */
const isForeign = (raw: string): boolean => {
  const trimmed = (raw || '').trim();
  if (!trimmed.startsWith('+')) return false;
  const digits = phoneDigits(trimmed);
  return digits.length > 0 && digits[0] !== '7' && digits[0] !== '8';
};

/**
 * Что не так с номером. null — номер годится.
 *
 * Пустое поле ошибкой не считается: телефон необязателен, заказ можно
 * принять и по имени.
 */
export function phoneProblem(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  const digits = phoneDigits(trimmed);
  if (!digits) return 'В номере нет ни одной цифры';

  // зарубежный номер не проверяем по российским правилам — только на вменяемую длину
  if (isForeign(trimmed)) {
    if (digits.length < 8 || digits.length > 15) return 'Похоже на опечатку — проверьте номер';
    return null;
  }

  /* Если код страны написан явно («+7…», «8…»), дописывать его нельзя.
   *
   * Иначе «+7988123456» — где потеряна одна цифра — превращается правилом
   * «десять цифр → добавить 7» в совершенно другой, но формально исправный
   * номер +7 (798) 812-34-56. Молча подменить номер клиента хуже, чем
   * попросить его перенабрать. */
  const hasCountryCode = trimmed.startsWith('+') || digits.startsWith('8');
  const expected = hasCountryCode ? digits.length : digits.length + 1;
  if (expected !== 11) {
    return expected < 11
      ? `Не хватает цифр: ${digits.length} из 11. Например +7 918 111-22-33`
      : `Лишние цифры: ${digits.length} вместо 11`;
  }

  const normalized = normalizePhone(trimmed);
  // после приведения первой всегда идёт 7 — если нет, это не российский номер
  if (!normalized.startsWith('7')) {
    return 'Российский номер начинается с +7 или 8';
  }
  return null;
}

/** Текст ошибки для тоста: «Проверьте телефон: не хватает цифр…».
 *
 *  Понижаем регистр только первой буквы — иначе toLowerCase() съедает и
 *  пример номера, и получается «например +7 918 111-22-33» с маленькой. */
export const phoneProblemInline = (problem: string): string =>
  problem.charAt(0).toLowerCase() + problem.slice(1);

/** +7 (918) 111-22-33 — как показываем и как кладём в базу.
 *
 *  Единый вид важен не только для красоты: в заказе телефон хранится
 *  строкой-снимком, и поиск по базе показывает именно её. */
export function formatPhone(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  // чужие форматы не трогаем: у каждой страны свой, испортить легко
  if (isForeign(trimmed) || phoneProblem(trimmed)) return trimmed;

  const n = normalizePhone(trimmed);
  return `+7 (${n.slice(1, 4)}) ${n.slice(4, 7)}-${n.slice(7, 9)}-${n.slice(9, 11)}`;
}
