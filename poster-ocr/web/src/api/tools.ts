/* Инструменты: файлы уходят на сервер на время запроса и там не хранятся. */

import type { DesignScene } from './designs';
import { request } from './client';

export interface ToolScene extends DesignScene {
  /** эскиз, сохранённый CorelDRAW, — data:-адрес PNG или null */
  thumbnail: string | null;
}

export function loadToolScene(file: File): Promise<ToolScene> {
  const form = new FormData();
  form.append('file', file);
  return request<ToolScene>('/tools/design-scene', { method: 'POST', body: form });
}
