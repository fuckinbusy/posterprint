/* Какие утилиты работают на этом сервере — спрашиваем один раз и помним:
   ответ зависит от сервера (есть ли разборщик .cdr), а не от пользователя. */

import { useQuery } from '@tanstack/react-query';

import { fetchToolsAvailability, type ToolAvailability } from '@/api/tools';

export function useAvailability() {
  const query = useQuery({
    queryKey: ['tools-availability'],
    queryFn: fetchToolsAvailability,
    staleTime: 10 * 60 * 1000,
  });
  const get = (key: string): ToolAvailability => query.data?.tools[key] ?? { available: true, reason: '' };
  return { get, loading: query.isLoading };
}
