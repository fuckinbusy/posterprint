/* Журнал сервера: последние строки лога, только для staff.manage. */

import { useQuery } from '@tanstack/react-query';

import { request } from './client';

export interface LogsResponse {
  name: string;
  lines: string[];
  /** какие файлы есть в папке логов; показываем только имя */
  files: { name: string }[];
}

export const fetchLogs = (name: string, lines: number, onlyProblems: boolean): Promise<LogsResponse> =>
  request<LogsResponse>(
    `/logs?name=${encodeURIComponent(name)}&lines=${lines}&only_problems=${onlyProblems}`,
  );

export function useLogs(name: string, lines: number, onlyProblems: boolean) {
  return useQuery({
    queryKey: ['logs', name, lines, onlyProblems],
    queryFn: () => fetchLogs(name, lines, onlyProblems),
    // журнал растёт постоянно — держим свежим, но не долбим сервер
    staleTime: 5 * 1000,
    placeholderData: (previous) => previous,
  });
}
