/* Калькулятор: чистые функции без React, чтобы их можно было проверить
   отдельно (tests/test_calc_js.py гоняет этот файл в Node). Деньги считаются
   в копейках через округление до сотых — ошибка здесь не падает, а тихо
   портит счёт клиенту. */

export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------ деньги */

/** НДС: mode 'add' — к сумме без НДС прибавить; 'extract' — из суммы с НДС выделить. */
export function vat(amount: number, ratePercent: number, mode: 'add' | 'extract'): { net: number; tax: number; gross: number } {
  const rate = ratePercent / 100;
  if (mode === 'add') {
    const tax = round2(amount * rate);
    return { net: round2(amount), tax, gross: round2(amount + tax) };
  }
  const net = round2(amount / (1 + rate));
  return { net, tax: round2(amount - net), gross: round2(amount) };
}

/** Цена с наценкой к себестоимости. */
export const markup = (cost: number, percent: number): number => round2(cost * (1 + percent / 100));

/** Цена после скидки. */
export const discount = (price: number, percent: number): number => round2(price * (1 - percent / 100));

/** Какая наценка в процентах от себестоимости до цены. */
export const marginPercent = (cost: number, price: number): number => (cost > 0 ? round2(((price - cost) / cost) * 100) : 0);

/** Разделить сумму на части поровну; копейки остатка — первым частям. */
export function split(total: number, parts: number): number[] {
  if (parts < 1) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / parts);
  const extra = cents - base * parts;
  return Array.from({ length: parts }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/** Сдача с внесённой суммы. */
export const change = (paid: number, due: number): number => round2(paid - due);

/** Перевод по курсу ЦБ (курс — рублей за единицу валюты). */
export const toRub = (amount: number, rate: number): number => round2(amount * rate);
export const fromRub = (rub: number, rate: number): number => (rate > 0 ? round2(rub / rate) : 0);

/* ------------------------------------------------------------ единицы длины */

/** В миллиметрах. Пиксели — при 96 dpi (CSS-пиксель); для печати есть pxToMm с dpi. */
export const LENGTH_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  pt: 25.4 / 72,
  px: 25.4 / 96,
};
export const LENGTH_LABELS: Record<string, string> = { mm: 'мм', cm: 'см', m: 'м', in: 'дюймы', pt: 'пункты', px: 'px (96 dpi)' };

export function convertLength(value: number, from: string, to: string): number {
  const a = LENGTH_MM[from];
  const b = LENGTH_MM[to];
  if (a === undefined || b === undefined) throw new Error(`неизвестная единица: ${from} → ${to}`);
  return (value * a) / b;
}

export const WEIGHT_G: Record<string, number> = { g: 1, kg: 1000, t: 1_000_000 };
export function convertWeight(value: number, from: string, to: string): number {
  return (value * WEIGHT_G[from]) / WEIGHT_G[to];
}

/* ------------------------------------------------------------ метраж */

/** Площадь в м² по сторонам в выбранной единице. */
export function areaM2(w: number, h: number, unit: string): number {
  const mm = LENGTH_MM[unit];
  return (w * mm * h * mm) / 1_000_000;
}

/** Периметр в метрах. */
export function perimeterM(w: number, h: number, unit: string): number {
  return (2 * (w + h) * LENGTH_MM[unit]) / 1000;
}

/** Сколько листов на тираж, если на лист входит perSheet штук. */
export const sheetsFor = (qty: number, perSheet: number): number => (perSheet > 0 ? Math.ceil(qty / perSheet) : 0);

/** Сколько изделий w×h (мм) встанет поперёк рулона шириной rollWidth (мм) с зазором gap. */
export function acrossRoll(itemW: number, rollWidth: number, gap: number): number {
  if (itemW <= 0 || itemW > rollWidth) return 0;
  return Math.floor((rollWidth + gap) / (itemW + gap));
}

/** Длина рулона в метрах на тираж: в ряд поперёк — across штук, рядов — qty/across, шаг ряда — h + gap. */
export function rollLengthM(itemW: number, itemH: number, qty: number, rollWidth: number, gap: number): number {
  const across = acrossRoll(itemW, rollWidth, gap);
  if (across === 0 || qty <= 0) return 0;
  const rows = Math.ceil(qty / across);
  return round2((rows * itemH + Math.max(rows - 1, 0) * gap) / 1000);
}

/* ------------------------------------------------------------ дизайн */

export const pxToMm = (px: number, dpi: number): number => (dpi > 0 ? (px / dpi) * 25.4 : 0);
export const mmToPx = (mm: number, dpi: number): number => Math.round((mm / 25.4) * dpi);
/** Какое разрешение даст картинка в px при печати на размер в мм. */
export const dpiFor = (px: number, mm: number): number => (mm > 0 ? Math.round((px / mm) * 25.4) : 0);

/** Вторая сторона при масштабировании с сохранением пропорций. */
export function scaleTo(w: number, h: number, newW: number): number {
  return w > 0 ? round2((h * newW) / w) : 0;
}

/** Размер с вылетами: обрезной формат + вылет с каждой стороны. */
export function withBleed(w: number, h: number, bleed: number): { w: number; h: number } {
  return { w: round2(w + 2 * bleed), h: round2(h + 2 * bleed) };
}
