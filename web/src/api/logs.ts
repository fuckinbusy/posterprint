/* Журнал сервера и резервные копии, только для staff.manage. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from './client';
import type { BackupResult, BackupsResponse } from '@/types/api';

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

/* ---------------------------------------------------- резервные копии */
export const fetchBackups = (): Promise<BackupsResponse> => request<BackupsResponse>('/logs/backups');

export const createBackup = (): Promise<BackupResult> =>
  request<BackupResult>('/logs/backup', { method: 'POST' });

export function useBackups() {
  return useQuery({
    queryKey: ['backups'],
    queryFn: fetchBackups,
    staleTime: 30 * 1000,
  });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBackup,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['backups'] }),
  });
}

