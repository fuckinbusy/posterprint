/* 16.5: раскладка PDF-макета на печатный лист с метками реза.

   Порядок: файл → страница и обрезной формат (по TrimBox файла или своей
   рамкой) → лист и параметры → превью (ответ движка на сервере) → «Скачать
   PDF». Файл уходит на сервер дважды — за сведениями о страницах и за
   готовым листом — и там не хранится. Цвета не трогаются: для печати в
   CMYK макет нужен именно в PDF, выгруженный из CorelDRAW. */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { imposeInfo, imposeLayout, imposePdf, type Box, type ImposeJob } from '@/api/tools';
import { useToast } from '@/app/ToastProvider';
import { PageHead } from '@/components/ui';
import { FileDrop } from '@/features/tools/FileDrop';

import { PagePicker } from './PagePicker';
import { MM, openPdf, renderPage, type RenderedPage } from './pdf';
import { SheetPreview } from './SheetPreview';

const SHEETS = {
  SRA3: [320, 450],
  A3: [297, 420],
  A4: [210, 297],
} as const;
type SheetName = keyof typeof SHEETS | 'custom';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Вылет, заложенный в файле: наименьшее расстояние от TrimBox до BleedBox, мм. */
function fileBleed(trim: Box | null, bleed: Box | null): number {
  if (!trim || !bleed) return 0;
  const d = Math.min(trim[0] - bleed[0], trim[1] - bleed[1], bleed[2] - trim[2], bleed[3] - trim[3]);
  return Math.max(0, Math.round((d / MM) * 10) / 10);
}

export function ImposePage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [pageIndex, setPageIndex] = useState(1);
  const [backPage, setBackPage] = useState<number | null>(null);
  const [flip, setFlip] = useState<'long' | 'short'>('long');
  const [trim, setTrim] = useState<Box | null>(null);
  const [image, setImage] = useState<RenderedPage | null>(null);
  const [sheet, setSheet] = useState<SheetName>('SRA3');
  const [custom, setCustom] = useState({ w: 320, h: 450 });
  const [params, setParams] = useState({ bleed: 2, margin: 5, gap: 0, rotate: true, marks: true, mark_offset: 2.5, mark_length: 3 });
  const [busy, setBusy] = useState(false);

  const info = useQuery({
    queryKey: ['impose-info', file?.name, file?.size, file?.lastModified],
    queryFn: () => imposeInfo(file!),
    enabled: Boolean(file),
    retry: false,
  });
  const page = info.data?.pages[pageIndex - 1];

  // новая страница — её обрезной формат и заложенный в файле вылет
  useEffect(() => {
    if (!page) return;
    setTrim(page.trim ?? page.media);
    setParams((p) => ({ ...p, bleed: fileBleed(page.trim, page.bleed) }));
  }, [page]);

  // картинка страницы — в браузере, pdf.js
  useEffect(() => {
    if (!file || !page) return undefined;
    let alive = true;
    void (async () => {
      const { doc, close } = await openPdf(file);
      try {
        const rendered = await renderPage(doc, page.index);
        if (alive) setImage(rendered);
      } finally {
        void close();
      }
    })().catch(() => toast('Страница не отрисовалась — но раскладка всё равно соберётся'));
    return () => {
      alive = false;
    };
  }, [file, page, toast]);

  const [sheetW, sheetH] = sheet === 'custom' ? [custom.w, custom.h] : SHEETS[sheet];
  const job: ImposeJob | null = useMemo(() => {
    if (!trim || !page) return null;
    let w = round2(Math.abs(trim[2] - trim[0]) / MM);
    let h = round2(Math.abs(trim[3] - trim[1]) / MM);
    if (page.rotate % 180 === 90) [w, h] = [h, w];
    return { item_w: w, item_h: h, sheet_w: sheetW, sheet_h: sheetH, ...params };
  }, [trim, page, sheetW, sheetH, params]);

  const layout = useQuery({
    queryKey: ['impose-layout', job],
    queryFn: () => imposeLayout(job!),
    enabled: Boolean(job),
    retry: false,
    placeholderData: (prev) => prev,
  });

  const download = async () => {
    if (!file || !trim) return;
    setBusy(true);
    try {
      const { blob, count } = await imposePdf(file, {
        ...params, sheet_w: sheetW, sheet_h: sheetH, page: pageIndex, back_page: backPage, flip, trim,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.name.replace(/\.pdf$/i, '')}-${sheet === 'custom' ? `${sheetW}x${sheetH}` : sheet}-${count}шт.pdf`;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = (key: keyof typeof params) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setParams({ ...params, [key]: Number(e.target.value) });

  return (
    <main className="page scroll-page">
      <div className="page-inner impose">
        <PageHead
          eyebrow="Инструменты"
          title="Раскладка под печать"
          sub="PDF-макет на лист с метками реза. Цвета CMYK и плашки остаются как в файле — выгружайте макет из CorelDRAW в PDF. Файл на сервере не сохраняется."
        />
        {!file && <FileDrop accept=".pdf" hint="Перетащите сюда PDF-макет или выберите его" onFile={setFile} />}
        {file && info.isLoading && <div className="mx-empty">Читаю PDF…</div>}
        {file && info.isError && (
          <div className="ip-error">
            {(info.error as Error).message}{' '}
            <button className="btn btn-ghost" type="button" onClick={() => setFile(null)}>Другой файл</button>
          </div>
        )}
        {file && info.data && page && trim && (
          <div className="ip-grid">
            <section className="ip-source">
              <div className="ip-row">
                <b>{file.name}</b>
                <button className="btn btn-ghost" type="button" onClick={() => { setFile(null); setImage(null); }}>
                  Другой файл
                </button>
              </div>
              {info.data.total > 1 && (
                <label className="ip-field">
                  <span>Лицо — страница</span>
                  <select value={pageIndex} onChange={(e) => setPageIndex(Number(e.target.value))}>
                    {info.data.pages.map((p) => <option key={p.index} value={p.index}>{p.index}</option>)}
                  </select>
                </label>
              )}
              {image ? <PagePicker page={page} image={image} trim={trim} onTrim={setTrim} /> : <div className="mx-empty">Рисую страницу…</div>}
              <p className="hint">
                Формат: {job?.item_w} × {job?.item_h} мм.{' '}
                {params.bleed === 0 && fileBleed(page.trim, page.bleed) === 0 && (
                  <span className="ip-warn">В файле нет вылетов — при резке по краю может остаться белая полоска.</span>
                )}
              </p>
            </section>

            <section className="ip-params">
              <label className="ip-field">
                <span>Лист</span>
                <select value={sheet} onChange={(e) => setSheet(e.target.value as SheetName)}>
                  <option value="SRA3">SRA3 · 320 × 450</option>
                  <option value="A3">A3 · 297 × 420</option>
                  <option value="A4">A4 · 210 × 297</option>
                  <option value="custom">Свой размер</option>
                </select>
              </label>
              {sheet === 'custom' && (
                <div className="ip-pair">
                  <input type="number" min={10} value={custom.w} onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })} />
                  <span>×</span>
                  <input type="number" min={10} value={custom.h} onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })} />
                </div>
              )}
              <label className="ip-field"><span>Непечатное поле, мм</span><input type="number" min={0} step={0.5} value={params.margin} onChange={num('margin')} /></label>
              <label className="ip-field"><span>Вылет, мм</span><input type="number" min={0} step={0.5} value={params.bleed} onChange={num('bleed')} /></label>
              <label className="ip-field">
                <span>Рез</span>
                <select value={params.gap === 0 ? 'butt' : 'gap'} onChange={(e) => setParams({ ...params, gap: e.target.value === 'butt' ? 0 : Math.max(4, params.bleed * 2) })}>
                  <option value="butt">Встык — один рез между изделиями</option>
                  <option value="gap">С зазором — вылет у каждого</option>
                </select>
              </label>
              {params.gap > 0 && <label className="ip-field"><span>Зазор, мм</span><input type="number" min={0} step={0.5} value={params.gap} onChange={num('gap')} /></label>}
              <label className="ip-check"><input type="checkbox" checked={params.rotate} onChange={(e) => setParams({ ...params, rotate: e.target.checked })} /> Можно поворачивать</label>
              <label className="ip-check"><input type="checkbox" checked={params.marks} onChange={(e) => setParams({ ...params, marks: e.target.checked })} /> Метки реза</label>
              {info.data.total > 1 && (
                <>
                  <label className="ip-field">
                    <span>Оборот — страница</span>
                    <select value={backPage ?? ''} onChange={(e) => setBackPage(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Без оборота</option>
                      {info.data.pages.map((p) => <option key={p.index} value={p.index}>{p.index}</option>)}
                    </select>
                  </label>
                  {backPage && (
                    <label className="ip-field">
                      <span>Переворот листа</span>
                      <select value={flip} onChange={(e) => setFlip(e.target.value as 'long' | 'short')}>
                        <option value="long">По длинной стороне</option>
                        <option value="short">По короткой стороне</option>
                      </select>
                    </label>
                  )}
                </>
              )}
            </section>

            <section className="ip-result">
              {layout.isError && <div className="ip-error">{(layout.error as Error).message}</div>}
              {layout.data && image && (
                <>
                  <div className="ip-count"><b>{layout.data.count}</b> шт. на листе · резов {layout.data.cuts.length}</div>
                  <SheetPreview layout={layout.data} image={image} trim={trim} itemW={job?.item_w ?? 0} />
                  <button className="btn btn-green" type="button" disabled={busy} onClick={() => void download()}>
                    {busy ? 'Собираю PDF…' : 'Скачать PDF'}
                  </button>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
