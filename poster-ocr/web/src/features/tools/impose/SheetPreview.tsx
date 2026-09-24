/* Превью листа: копии страницы там, где их поставит сервер, с обрезкой по
   вылетам, линии реза пунктиром и метки. Считает не браузер — рисует ответ
   /impose/layout, тот же движок собирает и PDF. */

import type { Box, ImposeLayout } from '@/api/tools';

import type { RenderedPage } from './pdf';

export function SheetPreview({
  layout,
  image,
  trim,
  itemW,
}: {
  layout: ImposeLayout;
  image: RenderedPage;
  trim: Box;
  /** видимая ширина обрезного формата, мм — как на экране, с учётом /Rotate */
  itemW: number;
}) {
  const t = image.toPx(trim);
  // миллиметров листа на пиксель картинки: картинка уже повёрнута как на
  // экране, поэтому её ширина по рамке — это видимая ширина формата
  const kx = itemW / Math.max(t[2] - t[0], 1);
  return (
    <svg className="ip-sheet" viewBox={`0 0 ${layout.sheet_w} ${layout.sheet_h}`}>
      <rect className="ip-paper" width={layout.sheet_w} height={layout.sheet_h} />
      <defs>
        {layout.placements.map((p, i) => (
          <clipPath id={`ipc${i}`} key={i}>
            <rect x={p.x - p.clip[0]} y={p.y - p.clip[1]} width={p.w + p.clip[0] + p.clip[2]} height={p.h + p.clip[1] + p.clip[3]} />
          </clipPath>
        ))}
      </defs>
      {layout.placements.map((p, i) => (
        <g clipPath={`url(#ipc${i})`} key={i}>
          <image
            href={image.url}
            width={image.width}
            height={image.height}
            transform={
              p.rotated
                ? `translate(${p.x + p.w} ${p.y}) rotate(90) scale(${kx}) translate(${-t[0]} ${-t[1]})`
                : `translate(${p.x} ${p.y}) scale(${kx}) translate(${-t[0]} ${-t[1]})`
            }
          />
        </g>
      ))}
      {layout.cuts.map((c, i) =>
        c.axis === 'x' ? (
          <line className="ip-cut" key={`c${i}`} x1={c.pos} y1={c.start} x2={c.pos} y2={c.end} />
        ) : (
          <line className="ip-cut" key={`c${i}`} x1={c.start} y1={c.pos} x2={c.end} y2={c.pos} />
        ),
      )}
      {layout.marks.map((m, i) => (
        <line className="ip-mark" key={`m${i}`} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} />
      ))}
    </svg>
  );
}
