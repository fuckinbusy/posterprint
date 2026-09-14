/* Обратная связь разработчику: отправить, посмотреть свои (или все — с
   правом staff.manage), ответить и сменить состояние. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from './client';
import type { Feedback, FeedbackKind, FeedbackStatus } from '@/types/api';

export interface FeedbackTargets {
  /** письмо разработчику через рабочий ящик настроено */
  mail: boolean;
  /** уведомление уходит на внешний адрес (бот, скрипт) */
  webhook: boolean;
}

export interface FeedbackPayload {
  kind: FeedbackKind;
  title: string;
  text: string;
  page: string;
}

const KEY = ['feedback'] as const;

export function useFeedbackList() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<Feedback[]>('/feedback'),
    staleTime: 15 * 1000,
  });
}

export function useFeedbackTargets() {
  return useQuery({
    queryKey: [...KEY, 'targets'],
    queryFn: () => request<FeedbackTargets>('/feedback/targets'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSendFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: FeedbackPayload) =>
      request<Feedback>('/feedback', { method: 'POST', body: payload }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; status?: FeedbackStatus; reply?: string }) =>
      request<Feedback>(`/feedback/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request<null>(`/feedback/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
