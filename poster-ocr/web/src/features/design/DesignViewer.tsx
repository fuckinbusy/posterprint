/* Просмотр содержимого макета: холст, который можно двигать и приближать,
   и сведения об объекте по щелчку — размер, положение, заливка, шрифт,
   разрешение растра.

   Файл разбирает сервер (libcdr) и отдаёт чистый SVG по страницам; здесь он
   вставляется как есть, поэтому масштаб — это просто ширина SVG в пикселях,
   а попадание по объекту считает сам браузер. Размеры берутся из геометрии
   объекта (без толщины обводки) и переводятся в миллиметры: координаты
   страницы — в пунктах, сервер присылает коэффициент.

   Рисуется в body поверх всего, как и увеличенное превью: окно заказа под
   ним остаётся открытым. */

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { fetchDesignExport, fetchDesignScene, type DesignPage } from '@/api/designs';
import { useToast } from '@/app/ToastProvider';
import { DownloadIcon } from '@/components/Icons';

const MIN_FIT = 0.05;
const MAX_ZOOM = 64; // во сколько раз можно приблизить относительно «вписать»

interface Picked {
  kind: string;
  group: boolean;
  /** в миллиметрах, от левого верхнего угла страницы */
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeMm: number;
  font: string;
  fontPt: number;
  text: string;
  children: number;
  /** растр: размер в пикселях и разрешение при таком размере на печати */
  pixels: string;
  dpi: number;
}

const KIND: Record<string, string> = {
  path: 'Кривая',
  rect: 'Прямоугольник',
  circle: 'Окружность',
  ellipse: 'Эллипс',
  line: 'Линия',
  polyline: 'Ломаная',
  polygon: 'Многоугольник',
  text: 'Текст',
  image: 'Растровое изображение',
  g: 'Группа',
};

const mm = (value: number): string =>
  `${value.toLocaleString('ru-RU', { minimumFractionDigits: value < 100 ? 1 : 0, maximumFractionDigits: value < 100 ? 2 : 1 })} мм`;

/** «rgb(34, 75, 135)» → «#224B87»; none и прозрачное — пусто. */
function colorText(value: string): string {
  if (!value || value === 'none' || value === 'transparent') return '';
  const m = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return value.startsWith('url(') ? 'градиент или узор' : value;
  if (m[4] !== undefined && Number(m[4]) === 0) return '';
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function DesignViewer({
  orderId,
  title,
  thumbnail,
  onClose,
}: {
  orderId: number;
  title: string;
  thumbnail: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const scene = useQuery({
    queryKey: ['design-scene', orderId],
    queryFn: () => fetchDesignScene(orderId),
    staleTime: 5 * 60 * 1000,
  });

  const [pageIndex, setPageIndex] = useState(0);
  const pages = scene.data?.pages ?? [];
  const page: DesignPage | undefined = pages[pageIndex];

  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const picked = useRef<SVGGraphicsElement | null>(null);

  /** px на миллиметр и сдвиг страницы внутри холста */
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [info, setInfo] = useState<Picked | null>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState('');

  /* ------------------------------------------------ Esc закрывает просмотр, а не заказ под ним */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  /* ------------------------------------------------ вставка SVG страницы */
  useLayoutEffect(() => {
    const node = holder.current;
    if (!node) return undefined;
    node.replaceChildren();
    svgRef.current = null;
    picked.current = null;
    setInfo(null);
    setFrame(null);
    if (!page) return undefined;
    // разбираем как XML, а не innerHTML: сервер уже вычистил разметку, но
    // так в страницу заведомо не попадёт ничего, кроме SVG-узлов
    const doc = new DOMParser().parseFromString(page.svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.nodeName !== 'svg') return undefined;
    const svg = document.importNode(root, true) as unknown as SVGSVGElement;
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('dv-svg');
    node.append(svg);
    svgRef.current = svg;
    return () => node.replaceChildren();
  }, [page]);

  /* ------------------------------------------------ вписать страницу в холст */
  const fit = useCallback(() => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !page) return;
    const pad = 48;
    const scale = Math.max(
      MIN_FIT,
      Math.min((box.width - pad * 2) / page.width_mm, (box.height - pad * 2) / page.height_mm),
    );
    setFitScale(scale);
    setView({
      scale,
      x: (box.width - page.width_mm * scale) / 2,
      y: (box.height - page.height_mm * scale) / 2,
    });
  }, [page]);

  useLayoutEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  /* ------------------------------------------------ масштаб вокруг точки */
  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const box = stage.current?.getBoundingClientRect();
      if (!box) return;
      const px = cx ?? box.width / 2;
      const py = cy ?? box.height / 2;
      setView((prev) => {
        const scale = Math.min(Math.max(prev.scale * factor, fitScale * 0.25), fitScale * MAX_ZOOM);
        const k = scale / prev.scale;
        return { scale, x: px - (px - prev.x) * k, y: py - (py - prev.y) * k };
      });
    },
    [fitScale],
  );

  // колесо вешаем руками: React ставит его пассивным, и страница под холстом прокручивалась бы
  useEffect(() => {
    const node = stage.current;
    if (!node) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = node.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - box.left, e.clientY - box.top);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') zoomAt(1.25);
      else if (e.key === '-') zoomAt(0.8);
      else if (e.key === '0') fit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoomAt, fit]);

  /* ------------------------------------------------ сведения об объекте */
  const describe = useCallback(
    (el: SVGGraphicsElement): { info: Picked; frame: NonNullable<typeof frame> } | null => {
      const svg = svgRef.current;
      const stageBox = stage.current?.getBoundingClientRect();
      if (!svg || !page || !stageBox) return null;
      let bbox: DOMRect;
      try {
        bbox = el.getBBox();
      } catch {
        return null;
      }
      const toScreen = el.getScreenCTM();
      if (!toScreen) return null;
      // углы геометрии объекта → экран; поворот учитывается, толщина обводки — нет
      const corners = [
        [bbox.x, bbox.y],
        [bbox.x + bbox.width, bbox.y],
        [bbox.x, bbox.y + bbox.height],
        [bbox.x + bbox.width, bbox.y + bbox.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(toScreen));
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      const width = Math.max(...xs) - left;
      const height = Math.max(...ys) - top;
      const svgBox = svg.getBoundingClientRect();
      const pxPerMm = svgBox.width / page.width_mm;

      const style = getComputedStyle(el);
      const kind = el.tagName.toLowerCase();
      const firstText = kind === 'text' ? el.querySelector('tspan') ?? el : el;
      const textStyle = getComputedStyle(firstText);
      const strokeUnits = parseFloat(style.strokeWidth) || 0;
      return {
        info: {
          kind,
          group: kind === 'g',
          x: (left - svgBox.left) / pxPerMm,
          y: (top - svgBox.top) / pxPerMm,
          w: width / pxPerMm,
          h: height / pxPerMm,
          fill: kind === 'g' || kind === 'image' ? '' : colorText(kind === 'text' ? textStyle.fill : style.fill),
          stroke: kind === 'g' || kind === 'image' ? '' : colorText(style.stroke),
          strokeMm: colorText(style.stroke) ? strokeUnits * page.mm_per_unit : 0,
          font: kind === 'text' ? textStyle.fontFamily.replace(/["']/g, '') : '',
          // размер шрифта в единицах страницы — это пункты
          fontPt: kind === 'text' ? parseFloat(firstText.getAttribute('font-size') ?? '') || 0 : 0,
          text: kind === 'text' ? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) : '',
          children: kind === 'g' ? el.querySelectorAll('[data-o]').length : 0,
          pixels: '',
          dpi: 0,
        },
        frame: { left: left - stageBox.left, top: top - stageBox.top, width, height },
      };
    },
    [page],
  );

  const select = useCallback(
    (el: SVGGraphicsElement | null) => {
      picked.current = el;
      if (!el) {
        setInfo(null);
        setFrame(null);
        return;
      }
      const result = describe(el);
      if (!result) return;
      setInfo(result.info);
      setFrame(result.frame);
      // у растра считаем разрешение: хватит ли его для печати в таком размере
      if (result.info.kind === 'image') {
        const href = el.getAttribute('href') ?? '';
        const probe = new Image();
        probe.onload = () => {
          if (picked.current !== el) return;
          const inches = result.info.w / 25.4;
          setInfo((prev) =>
            prev && {
              ...prev,
              pixels: `${probe.naturalWidth} × ${probe.naturalHeight} px`,
              dpi: inches > 0 ? Math.round(probe.naturalWidth / inches) : 0,
            },
          );
        };
        probe.src = href;
      }
    },
    [describe],
  );

  // рамка выделения живёт в координатах экрана — после сдвига и масштаба её надо пересчитать
  useLayoutEffect(() => {
    if (!picked.current) return;
    const result = describe(picked.current);
    if (result) setFrame(result.frame);
  }, [view, describe]);

  /* ------------------------------------------------ мышь: тянем холст, щелчком выбираем */
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const svgBox = svgRef.current?.getBoundingClientRect();
    if (svgBox && page) {
      const pxPerMm = svgBox.width / page.width_mm;
      setCursor({ x: (e.clientX - svgBox.left) / pxPerMm, y: (e.clientY - svgBox.top) / pxPerMm });
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setView((prev) => ({ ...prev, x: d.vx + dx, y: d.vy + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    // щелчок без протяжки: что под курсором. Указатель захвачен холстом,
    // поэтому цель события — не объект; спрашиваем у документа
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const target = hit?.closest?.('[data-o]') as SVGGraphicsElement | null;
    select(target && svgRef.current?.contains(target) ? target : null);
  };

  const selectGroup = () => {
    const current = picked.current;
    const parent = current?.parentElement as unknown as SVGGraphicsElement | null;
    if (!parent || parent.tagName.toLowerCase() !== 'g' || parent.parentElement === (svgRef.current as unknown)) return;
    select(parent);
  };
  const canGroup = (() => {
    const parent = picked.current?.parentElement;
    return Boolean(parent && parent.tagName.toLowerCase() === 'g' && parent.parentElement !== (svgRef.current as unknown));
  })();

  /* ------------------------------------------------ выгрузка */
  const exportAs = async (format: 'svg' | 'pdf') => {
    setExporting(format);
    try {
      const blob = await fetchDesignExport(orderId, format, (page?.index ?? 1));
      if (!blob) {
        toast(
          format === 'pdf'
            ? 'PDF не получился: для него на сервере нужен Inkscape. SVG доступен и без него.'
            : 'Не удалось выгрузить макет',
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/\.cdr$/i, '')}${pages.length > 1 && format === 'svg' ? `-стр${page?.index}` : ''}.${format}`;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setExporting('');
    }
  };

  const percent = useMemo(() => Math.round((view.scale / fitScale) * 100), [view.scale, fitScale]);
  const data = scene.data;
  const newer = (data?.version?.number ?? 0) > 16;

  return createPortal(
    <div className="dv" role="dialog" aria-modal="true" aria-label="Просмотр макета">
      <div className="dv-bar">
        <div className="dv-title">
          <b>{title}</b>
          {data?.version && <span>{data.version.label}</span>}
        </div>

        {pages.length > 1 && (
          <div className="dv-pages">
            {pages.map((p, i) => (
              <button
                key={p.index}
                type="button"
                className={i === pageIndex ? 'on' : ''}
                onClick={() => setPageIndex(i)}
              >
                Стр. {p.index}
              </button>
            ))}
          </div>
        )}

        <div className="dv-zoom">
          <button type="button" title="Отдалить (−)" onClick={() => zoomAt(0.8)}>
            −
          </button>
          <span>{percent}%</span>
          <button type="button" title="Приблизить (+)" onClick={() => zoomAt(1.25)}>
            +
          </button>
          <button type="button" className="wide" title="Вписать в окно (0)" onClick={fit}>
            Вписать
          </button>
        </div>

        <div className="dv-export">
          <button
            type="button"
            className="wide"
            disabled={!data?.available || Boolean(exporting)}
            title="SVG в натуральную величину — CorelDRAW X6 откроет его через «Импорт»"
            onClick={() => void exportAs('svg')}
          >
            <DownloadIcon /> {exporting === 'svg' ? 'Готовлю…' : 'SVG'}
          </button>
          <button
            type="button"
            className="wide"
            disabled={!data?.available || !data?.tools.can_pdf || Boolean(exporting)}
            title={data?.tools.can_pdf ? 'PDF — для открытия в CorelDRAW X6' : 'Для PDF на сервере нужен Inkscape'}
            onClick={() => void exportAs('pdf')}
          >
            <DownloadIcon /> {exporting === 'pdf' ? 'Готовлю…' : 'PDF'}
          </button>
        </div>

        <button type="button" className="dv-close" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="dv-body">
        <div
          className="dv-stage"
          ref={stage}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setCursor(null)}
        >
          {scene.isLoading && <div className="dv-msg">Разбираю макет…</div>}
          {scene.isError && <div className="dv-msg">{(scene.error as Error).message}</div>}
          {data && !data.available && (
            <div className="dv-msg">
              <b>Содержимое показать не получилось</b>
              <span>{data.reason}</span>
              {thumbnail && <img src={thumbnail} alt="Эскиз из файла" />}
            </div>
          )}
          <div
            className="dv-page"
            style={{
              transform: `translate(${view.x}px, ${view.y}px)`,
              width: page ? page.width_mm * view.scale : 0,
              height: page ? page.height_mm * view.scale : 0,
              visibility: page ? 'visible' : 'hidden',
            }}
          >
            <div ref={holder} className="dv-holder" />
          </div>
          {frame && info && (
            <div className="dv-frame" style={frame}>
              <i className="w">{mm(info.w)}</i>
              <i className="h">{mm(info.h)}</i>
            </div>
          )}
          {page && (
            <div className="dv-status">
              Страница {mm(page.width_mm)} × {mm(page.height_mm)}
              {cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x <= page.width_mm && cursor.y <= page.height_mm && (
                <>
                  {' · '}X {mm(cursor.x)} · Y {mm(cursor.y)}
                </>
              )}
            </div>
          )}
        </div>

        <aside className="dv-side">
          {info ? (
            <section>
              <h4>Объект</h4>
              <dl>
                <dt>Тип</dt>
                <dd>
                  {KIND[info.kind] ?? info.kind}
                  {info.group ? ` · объектов: ${info.children}` : ''}
                </dd>
                <dt>Ширина</dt>
                <dd className="big">{mm(info.w)}</dd>
                <dt>Высота</dt>
                <dd className="big">{mm(info.h)}</dd>
                <dt>От левого края</dt>
                <dd>{mm(info.x)}</dd>
                <dt>От верхнего края</dt>
                <dd>{mm(info.y)}</dd>
                {info.fill && (
                  <>
                    <dt>Заливка</dt>
                    <dd>
                      {info.fill.startsWith('#') && <i className="dv-chip" style={{ background: info.fill }} />}
                      {info.fill}
                    </dd>
                  </>
                )}
                {info.stroke && (
                  <>
                    <dt>Обводка</dt>
                    <dd>
                      {info.stroke.startsWith('#') && <i className="dv-chip" style={{ background: info.stroke }} />}
                      {info.stroke} · {mm(info.strokeMm)}
                    </dd>
                  </>
                )}
                {info.font && (
                  <>
                    <dt>Шрифт</dt>
                    <dd>
                      {info.font}
                      {info.fontPt ? ` · ${info.fontPt.toLocaleString('ru-RU')} пт` : ''}
                    </dd>
                  </>
                )}
                {info.text && (
                  <>
                    <dt>Текст</dt>
                    <dd className="quote">{info.text}</dd>
                  </>
                )}
                {info.pixels && (
                  <>
                    <dt>Растр</dt>
                    <dd>{info.pixels}</dd>
                    <dt>Разрешение</dt>
                    <dd className={info.dpi < 150 ? 'warn' : ''}>
                      {info.dpi} dpi{info.dpi < 150 ? ' — для печати мало' : ''}
                    </dd>
                  </>
                )}
              </dl>
              {info.kind !== 'g' && info.kind !== 'image' && (
                <p className="dv-hint">Размер — по контуру объекта, без толщины обводки.</p>
              )}
              <div className="dv-side-actions">
                <button type="button" disabled={!canGroup} onClick={selectGroup}>
                  Вся группа
                </button>
                <button type="button" onClick={() => select(null)}>
                  Снять выделение
                </button>
              </div>
            </section>
          ) : (
            <section>
              <h4>Объект</h4>
              <p className="dv-hint">
                Щёлкните по объекту — покажу размер, положение, цвет. Холст двигается мышью, колесо
                приближает.
              </p>
            </section>
          )}

          {data?.available && (
            <section>
              <h4>Документ</h4>
              <dl>
                {data.version && (
                  <>
                    <dt>Сохранён в</dt>
                    <dd>{data.version.name}</dd>
                  </>
                )}
                {page && (
                  <>
                    <dt>Страница</dt>
                    <dd>
                      {mm(page.width_mm)} × {mm(page.height_mm)}
                    </dd>
                  </>
                )}
                <dt>Объектов</dt>
                <dd>
                  {data.stats?.objects ?? 0}
                  {data.stats ? ` · кривых ${data.stats.curves}, текстов ${data.stats.texts}, растров ${data.stats.images}` : ''}
                </dd>
                {(data.fonts ?? []).length > 0 && (
                  <>
                    <dt>Шрифты</dt>
                    <dd>{(data.fonts ?? []).join(', ')}</dd>
                  </>
                )}
              </dl>
              {newer && (
                <p className="dv-note">
                  Файл новее CorelDRAW X6 — он его не откроет. Скачайте SVG или PDF кнопками наверху и
                  импортируйте в X6: кривые и размеры переносятся один к одному. Готовый .cdr версии 16 делает
                  скрипт scripts/cdr_to_v16.ps1 на компьютере с CorelDRAW.
                </p>
              )}
              {(data.warnings ?? []).map((w) => (
                <p className="dv-hint" key={w}>
                  {w}
                </p>
              ))}
            </section>
          )}

          {thumbnail && data?.available && (
            <section>
              <h4>Эскиз из файла</h4>
              <img className="dv-thumb" src={thumbnail} alt="Эскиз, сохранённый CorelDRAW" />
              <p className="dv-hint">Так макет выглядит в самом CorelDRAW — сверяйтесь, если что-то отличается.</p>
            </section>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
