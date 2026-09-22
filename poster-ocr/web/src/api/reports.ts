/* Отчёты. Пока один — касса за день.

   Границы дня считаем здесь, а не на сервере: только браузер знает, в каком
   часовом поясе стоит компьютер за стойкой. Серверу уходят два момента в
   ISO — начало и конец местных суток. */

import { useQuery } from '@tanstack/react-query';

import { request } from './client';
import { qk } from './keys';
import type { CashReport } from '@/types/api';

/** Начало и конец местных суток для даты «ГГГГ-ММ-ДД». */
export function dayBounds(dateISO: string): { from: string; to: string } {
  const [y, m, d] = dateISO.split('-').map(Number);
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export const fetchCashReport = (dateISO: string): Promise<CashReport> => {
  const { from, to } = dayBounds(dateISO);
  return request<CashReport>(`/reports/cash?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
};

export function useCashReport(dateISO: string) {
  return useQuery({
    queryKey: qk.cash(dateISO),
    queryFn: () => fetchCashReport(dateISO),
    // деньги вносятся из карточек заказов; после каждого сохранения кэш
    // заказов сбрасывается, а этот — по времени, чтобы не гонять отчёт зря
    staleTime: 15 * 1000,
    placeholderData: (previous) => previous,
  });
}
