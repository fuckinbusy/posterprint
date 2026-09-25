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

/** Ссылка на поиск fonts-online.ru — туда, где шрифта нет в Google Fonts.
 *  Только ссылка: их правила запрещают качать программой. */
export const fontsOnlineSearch = (name: string): string => `https://fonts-online.ru/search?q=${encodeURIComponent(name)}`;

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
  {
    key: 'fonts',
    path: '/tools/fonts',
    title: 'Шрифты',
    hint: 'Найти и скачать шрифт из Google Fonts (есть кириллица), узнать, какие шрифты нужны макету .cdr.',
    permission: 'tools.fonts',
  },
  {
    key: 'calc',
    path: '/tools/calc',
    title: 'Калькулятор',
    hint: 'Деньги с НДС и курсы ЦБ, метраж и рулоны, размеры и DPI для дизайна, перевод единиц.',
    permission: 'tools.calc',
  },
];

export const toolByPath = (path: string): ToolConfig | undefined => TOOLS.find((t) => t.path === path);
