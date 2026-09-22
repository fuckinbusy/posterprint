/* Виды работ: список, справочник ролей, конструктор, проверка расчёта. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from './client';
import { qk } from './keys';
import type {
  Estimate,
  TemplateMeta,
  WorkPreviewPayload,
  WorkTemplate,
  WorkTemplatePayload,
} from '@/types/api';

export const fetchTemplates = (): Promise<WorkTemplate[]> => request<WorkTemplate[]>('/templates');

export const fetchTemplateMeta = (): Promise<TemplateMeta> =>
  request<TemplateMeta>('/templates/meta');

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: qk.templates,
    queryFn: fetchTemplates,
    enabled,
  });
}

export function useTemplateMeta(enabled = true) {
  return useQuery({
    queryKey: qk.templateMeta,
    queryFn: fetchTemplateMeta,
    enabled,
    staleTime: Infinity, // справочник ролей зашит в коде сервера
  });
}

export const createTemplate = (payload: WorkTemplatePayload): Promise<WorkTemplate> =>
  request<WorkTemplate>('/templates', { method: 'POST', body: payload });

export const updateTemplate = (id: number, payload: WorkTemplatePayload): Promise<WorkTemplate> =>
  request<WorkTemplate>(`/templates/${id}`, { method: 'PATCH', body: payload });

export const deleteTemplate = (id: number): Promise<null> =>
  request<null>(`/templates/${id}`, { method: 'DELETE' });

/** Расчёт по несохранённым полям — кнопка «Посчитать пример» в конструкторе. */
export const previewTemplate = (payload: WorkPreviewPayload): Promise<Estimate> =>
  request<Estimate>('/templates/preview', { method: 'POST', body: payload });

/** После правки вида работ форма заказа и доска должны увидеть новый набор полей. */
export function useTemplatesInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.templates });
    qc.invalidateQueries({ queryKey: qk.catalog });
  };
}

export function useSaveTemplate() {
  const invalidate = useTemplatesInvalidation();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: WorkTemplatePayload }) =>
      id === null ? createTemplate(payload) : updateTemplate(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteTemplate() {
  const invalidate = useTemplatesInvalidation();
  return useMutation({
    mutationFn: deleteTemplate,
    onSuccess: invalidate,
  });
}
