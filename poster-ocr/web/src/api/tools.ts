/* Инструменты: файлы уходят на сервер на время запроса и там не хранятся. */

import type { DesignScene } from './designs';
import { request, requestBlob, requestFormBlob } from './client';

export interface ToolScene extends DesignScene {
  /** эскиз, сохранённый CorelDRAW, — data:-адрес PNG или null */
  thumbnail: string | null;
}

export function loadToolScene(file: File): Promise<ToolScene> {
  const form = new FormData();
  form.append('file', file);
  return request<ToolScene>('/tools/design-scene', { method: 'POST', body: form });
}


export type Box = [number, number, number, number];

export interface PdfPageInfo {
  index: number;
  rotate: number;
  media: Box;
  trim: Box | null;
  bleed: Box | null;
  width_mm: number;
  height_mm: number;
}

export interface ImposeJob {
  item_w: number;
  item_h: number;
  bleed: number;
  sheet_w: number;
  sheet_h: number;
  margin: number;
  gap: number;
  rotate: boolean;
  marks: boolean;
  mark_offset: number;
  mark_length: number;
}

export interface ImposePlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
  /** слева, сверху, справа, снизу — мм вылета */
  clip: [number, number, number, number];
}

export interface ImposeLayout {
  count: number;
  sheet_w: number;
  sheet_h: number;
  placements: ImposePlacement[];
  cuts: { axis: 'x' | 'y'; pos: number; start: number; end: number }[];
  marks: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface SheetParams extends Omit<ImposeJob, 'item_w' | 'item_h'> {
  page: number;
  back_page: number | null;
  flip: 'long' | 'short';
  trim: Box;
}

export function imposeInfo(file: File): Promise<{ pages: PdfPageInfo[]; total: number }> {
  const form = new FormData();
  form.append('file', file);
  return request('/tools/impose/info', { method: 'POST', body: form });
}

export const imposeLayout = (job: ImposeJob): Promise<ImposeLayout> =>
  request('/tools/impose/layout', { method: 'POST', body: job });

export async function imposePdf(file: File, params: SheetParams): Promise<{ blob: Blob; count: number }> {
  const form = new FormData();
  form.append('file', file);
  form.append('params', JSON.stringify(params));
  const { blob, headers } = await requestFormBlob('/tools/impose/pdf', form);
  return { blob, count: Number(headers.get('X-Impose-Count') ?? 0) };
}

/* ---------------------------------------------------------------- доступность, шрифты, курсы */

export interface ToolAvailability {
  available: boolean;
  /** почему недоступно на этом сервере */
  reason: string;
}

export const fetchToolsAvailability = (): Promise<{ tools: Record<string, ToolAvailability> }> => request('/tools');

export interface FontFamily {
  family: string;
  category: string;
  subsets: string[];
  /** «400», «700i» … */
  variants: string[];
  axes: string[];
  popularity: number;
}

export const fontsSearch = (q: string, cyrillic: boolean, category: string, limit = 60): Promise<{ families: FontFamily[]; total: number }> =>
  request(`/tools/fonts?q=${encodeURIComponent(q)}&cyrillic=${cyrillic}&category=${encodeURIComponent(category)}&limit=${limit}`);

export const fontsDownload = (family: string, styles: string[]): Promise<Blob | null> =>
  requestBlob(`/tools/fonts/download?family=${encodeURIComponent(family)}&styles=${styles.join(',')}`);

export interface CdrFont {
  name: string;
  status: 'system' | 'google' | 'unknown';
  google: FontFamily | null;
}

export function fontsFromCdr(file: File): Promise<{ fonts: CdrFont[]; version: { number: number; name: string; label: string } | null; note: string }> {
  const form = new FormData();
  form.append('file', file);
  return request('/tools/fonts/from-cdr', { method: 'POST', body: form });
}

export interface Rates {
  date: string;
  stale: boolean;
  rates: Record<string, { value: number; name: string }>;
}

export const fetchRates = (): Promise<Rates> => request('/tools/rates');
