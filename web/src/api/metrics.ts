/* Метрики. Период — либо последние N дней (0 — всё время), либо
   календарный месяц: его границы считаем здесь, в поясе компьютера за
   стойкой, и отдаём серверу двумя моментами в ISO — как у кассы за день. */

import { useQuery } from '@tanstack/react-query';

import { request } from './client';
import { qk } from './keys';
import type { Metrics } from '@/types/api';

/** Что показывать: `{ days }` или `{ month: 'ГГГГ-ММ' }`. */
export type MetricsPeriod = { days: number } | { month: string };

export function periodKey(period: MetricsPeriod): string {
  return 'month' in period ? `month:${period.month}` : `days:${period.days}`;
}

/** Начало месяца и начало следующего — в местном времени. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
}

/** «ГГГГ-ММ» текущего месяца. */
export function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Сдвиг месяца на n вперёд или назад. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const text = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1).replace(' г.', '');
}

/** Смещение местного времени от UTC в минутах: дни на графике и «выдан в
 *  срок» сервер считает в поясе компьютера, а не по Гринвичу. */
const tz = () => -new Date().getTimezoneOffset();

export const fetchMetrics = (period: MetricsPeriod): Promise<Metrics> => {
  if ('month' in period) {
    const { from, to } = monthBounds(period.month);
    return request<Metrics>(
      `/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&top=50&tz=${tz()}`,
    );
  }
  return request<Metrics>(`/metrics?days=${period.days}&top=50&tz=${tz()}`);
};

export function useMetrics(period: MetricsPeriod, enabled = true) {
  return useQuery({
    queryKey: qk.metrics(periodKey(period)),
    queryFn: () => fetchMetrics(period),
    enabled,
    // пересчёт идёт по всем заказам периода разом — держим результат подольше
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
