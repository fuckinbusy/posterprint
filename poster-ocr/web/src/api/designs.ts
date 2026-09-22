/* Макеты заказов: сведения о файле, превью, загрузка, скачивание, удаление. */

import { useQuery } from '@tanstack/react-query';

import { request, requestBlob } from './client';
import { qk } from './keys';
import type { DesignInfo, DesignLink } from '@/types/api';

/** Максимум, который принимает сервер. Проверяем и здесь: незачем гнать
 *  по сети 400 МБ, чтобы получить отказ. */
export const MAX_DESIGN_BYTES = 300 * 1024 * 1024;

export const fetchDesignInfo = (orderId: number): Promise<DesignInfo> =>
  request<DesignInfo>(`/orders/${orderId}/design`);

export const fetchDesignPreview = (orderId: number): Promise<Blob | null> =>
  requestBlob(`/orders/${orderId}/design/preview`);

export const fetchDesignLink = (orderId: number): Promise<DesignLink> =>
  request<DesignLink>(`/orders/${orderId}/design/link`);

export function uploadDesign(orderId: number, file: File): Promise<DesignInfo> {
  const form = new FormData();
  form.append('file', file);
  return request<DesignInfo>(`/orders/${orderId}/design`, { method: 'POST', body: form });
}

export const deleteDesign = (orderId: number): Promise<null> =>
  request<null>(`/orders/${orderId}/design`, { method: 'DELETE' });

export function useDesignInfo(orderId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.design(orderId ?? 0),
    queryFn: () => fetchDesignInfo(orderId as number),
    enabled: orderId !== null && enabled,
  });
}

/* ---------------------------------------------------- содержимое макета */
/** Страница макета: чистый SVG и размеры. Координаты внутри — в пунктах
 *  (1/72 дюйма); mm_per_unit переводит их в миллиметры. */
export interface DesignPage {
  index: number;
  width_mm: number;
  height_mm: number;
  view_box: [number, number, number, number];
  mm_per_unit: number;
  objects: number;
  svg: string;
}

export interface DesignVersion {
  number: number;
  name: string;
  label: string;
}

export interface DesignScene {
  available: boolean;
  /** почему содержимое показать нельзя: нет разборщика, файл не читается */
  reason: string;
  version: DesignVersion | null;
  tools: { libcdr: string; inkscape: string; can_view: boolean; can_pdf: boolean };
  tool?: string;
  pages?: DesignPage[];
  stats?: { objects: number; curves: number; texts: number; images: number };
  fonts?: string[];
  warnings?: string[];
}

export const fetchDesignScene = (orderId: number): Promise<DesignScene> =>
  request<DesignScene>(`/orders/${orderId}/design/scene`);

/** Макет в открытом формате — чтобы открыть файл новой версии в старом CorelDRAW. */
export const fetchDesignExport = (orderId: number, format: 'svg' | 'pdf', page = 1): Promise<Blob | null> =>
  requestBlob(`/orders/${orderId}/design/export?format=${format}&page=${page}`);
