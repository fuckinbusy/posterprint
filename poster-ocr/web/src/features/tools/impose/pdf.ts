/* pdf.js — только здесь и только на странице раскладки (кусок сборки
   грузится лениво). Страница рисуется в браузере из того же файла, что
   уйдёт на сервер, — отдельной ручки для картинки не нужно.

   Координаты: сервер отдаёт рамки в собственных координатах PDF (пункты,
   начало снизу слева, без учёта /Rotate). viewport pdf.js переводит их в
   пиксели картинки с учётом поворота и CropBox — и обратно. */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import type { Box } from '@/api/tools';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const MM = 72 / 25.4;

export interface RenderedPage {
  /** картинка страницы, data:-адрес PNG */
  url: string;
  width: number;
  height: number;
  /** пункты PDF → пиксели картинки: [x0, y0, x1, y1], упорядочено */
  toPx: (box: Box) => Box;
  /** пиксель картинки → пункты PDF */
  toPdf: (x: number, y: number) => [number, number];
}

/** Открыть PDF из файла. close() освобождает worker — звать, когда страница
 *  отрисована: в pdfjs-dist 6 закрывается задача загрузки, не документ. */
export async function openPdf(file: File): Promise<{ doc: pdfjs.PDFDocumentProxy; close: () => Promise<void> }> {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  return { doc: await task.promise, close: () => task.destroy() };
}

export async function renderPage(doc: pdfjs.PDFDocumentProxy, index: number, maxSide = 1400): Promise<RenderedPage> {
  const page = await doc.getPage(index);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxSide / Math.max(base.width, base.height), 4);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return {
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    toPx: (box) => {
      // два угла рамки — в пиксели; с поворотом страницы они меняются местами
      const [a, b] = viewport.convertToViewportPoint(box[0], box[1]) as [number, number];
      const [c, d] = viewport.convertToViewportPoint(box[2], box[3]) as [number, number];
      return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
    },
    toPdf: (x, y) => viewport.convertToPdfPoint(x, y) as [number, number],
  };
}
