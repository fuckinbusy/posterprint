/* Страница сцены как самостоятельный SVG в натуральную величину — CorelDRAW
   при импорте ставит его в мм. Копия app/services/cdr_scene.standalone_svg:
   макет из «Инструментов» на сервере не хранится, выгружать его нечем, а
   сцена со SVG уже в браузере. */

import type { DesignPage } from '@/api/designs';

export function standaloneSvg(page: DesignPage): Blob {
  const doc = new DOMParser().parseFromString(page.svg, 'image/svg+xml');
  const root = doc.documentElement;
  root.setAttribute('width', `${page.width_mm}mm`);
  root.setAttribute('height', `${page.height_mm}mm`);
  root.setAttribute('version', '1.1');
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    el.removeAttribute('data-o');
    el.removeAttribute('data-kind');
  }
  const xml = new XMLSerializer().serializeToString(root);
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: 'image/svg+xml' });
}
