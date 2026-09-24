/* Страница PDF с рамками: пунктир — обрезной формат, тонкая — вылеты.
   Потянуть мышью — выбрать свою область (например, одну визитку с листа
   дизайнера); кнопками — вернуться к TrimBox или ко всей странице. */

import { useRef, useState } from 'react';

import type { Box, PdfPageInfo } from '@/api/tools';

import type { RenderedPage } from './pdf';

export function PagePicker({
  page,
  image,
  trim,
  onTrim,
}: {
  page: PdfPageInfo;
  image: RenderedPage;
  trim: Box;
  onTrim: (box: Box) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const local = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * image.width, y: ((e.clientY - r.top) / r.height) * image.height };
  };
  const t = image.toPx(trim);
  const bleed = page.bleed ? image.toPx(page.bleed) : null;

  return (
    <div className="ip-picker">
      <svg
        ref={svg}
        viewBox={`0 0 ${image.width} ${image.height}`}
        onPointerDown={(e) => {
          const p = local(e);
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = local(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (drag && Math.abs(drag.x1 - drag.x0) > 6 && Math.abs(drag.y1 - drag.y0) > 6) {
            const [ax, ay] = image.toPdf(drag.x0, drag.y0);
            const [bx, by] = image.toPdf(drag.x1, drag.y1);
            onTrim([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
          }
          setDrag(null);
        }}
      >
        <image href={image.url} width={image.width} height={image.height} />
        {bleed && (
          <rect className="ip-bleed" x={bleed[0]} y={bleed[1]} width={bleed[2] - bleed[0]} height={bleed[3] - bleed[1]} />
        )}
        <rect className="ip-trim" x={t[0]} y={t[1]} width={t[2] - t[0]} height={t[3] - t[1]} />
        {drag && (
          <rect
            className="ip-drag"
            x={Math.min(drag.x0, drag.x1)}
            y={Math.min(drag.y0, drag.y1)}
            width={Math.abs(drag.x1 - drag.x0)}
            height={Math.abs(drag.y1 - drag.y0)}
          />
        )}
      </svg>
      <div className="ip-picker-actions">
        {page.trim && (
          <button className="btn btn-ghost" type="button" onClick={() => onTrim(page.trim!)}>
            По обрезному формату файла
          </button>
        )}
        <button className="btn btn-ghost" type="button" onClick={() => onTrim(page.media)}>
          Вся страница
        </button>
        <span className="hint">Потяните мышью по странице, чтобы выбрать свою область</span>
      </div>
    </div>
  );
}
