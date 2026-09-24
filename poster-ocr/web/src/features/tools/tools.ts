/* Утилиты раздела «Инструменты»: адрес, название, право. По этому списку
   строятся плитки, маршруты и заголовок вкладки браузера. */

import type { Permission } from '@/types/api';

export interface ToolConfig {
  key: string;
  path: string;
  title: string;
  /** одна строка на плитке: что делает */
  hint: string;
  permission: Permission;
}

export const TOOLS: ToolConfig[] = [
  {
    key: 'viewer',
    path: '/tools/viewer',
    title: 'Просмотр макета',
    hint: 'Открыть любой .cdr: размеры объектов, шрифты, версия CorelDRAW. Файл не сохраняется.',
    permission: 'tools.viewer',
  },
  {
    key: 'impose',
    path: '/tools/impose',
    title: 'Раскладка под печать',
    hint: 'PDF-макет на лист SRA3, A3 или A4 с метками реза. Цвета CMYK — как в файле.',
    permission: 'tools.impose',
  },
];

export const toolByPath = (path: string): ToolConfig | undefined => TOOLS.find((t) => t.path === path);
