/* Метрики. Период задаётся в днях, 0 — за всё время. */

import { useQuery } from '@tanstack/react-query';

import { request } from './client';
import { qk } from './keys';
import type { Metrics } from '@/types/api';

export const fetchMetrics = (days: number): Promise<Metrics> =>
  request<Metrics>(`/metrics?days=${days}&top=50`);

export function useMetrics(days: number, enabled = true) {
  return useQuery({
    queryKey: qk.metrics(days),
    queryFn: () => fetchMetrics(days),
    enabled,
    // пересчёт идёт по всем заказам разом — держим результат подольше
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
