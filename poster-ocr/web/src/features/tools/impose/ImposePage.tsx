/* 16.5: раскладка PDF-макета на печатный лист с метками реза.

   Порядок: файл → страница и обрезной формат (по TrimBox файла или своей
   рамкой) → лист и параметры → превью (ответ движка на сервере) → «Скачать
   PDF». Файл уходит на сервер дважды — за сведениями о страницах и за
   готовым листом — и там не хранится. Цвета не трогаются: для печати в
   CMYK макет нужен именно в PDF, выгруженный из CorelDRAW.

   Поля формы — те же, что везде в системе: Field, Select, label.check. */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { imposeInfo, imposeLayout, imposePdf, type Box, type ImposeJob } from '@/api/tools';
import { useToast } from '@/app/ToastProvider';
import { Select } from '@/components/Select';
import { Field, PageHead } from '@/components/ui';
import { FileDrop } from '@/features/tools/FileDrop';
import { ToolsNotice } from '@/features/tools/ToolsNotice';

import { PagePicker } from './PagePicker';
import { MM, openPdf, renderPage, type RenderedPage } from './pdf';
import { SheetPreview } from './SheetPreview';

const SHEETS = {
  SRA3: [320, 450],
  A3: [297, 420],
  A4: [210, 297],
} as const;
type SheetName = keyof typeof SHEETS | 'custom';
const SHEET_OPTIONS = [
  { value: 'SRA3', label: 'SRA3 · 320 × 450' },
  { value: 'A3', label: 'A3 · 297 × 420' },
  { value: 'A4', label: 'A4 · 210 × 297' },
  { value: 'custom', label: 'Свой размер' },
];
const CUT_OPTIONS = [
  { value: 'butt', label: 'Встык — один рез между изделиями' },
  { value: 'gap', label: 'С зазором — вылет у каждого' },
];
const FLIP_OPTIONS = [
  { value: 'long', label: 'По длинной стороне' },
  { value: 'short', label: 'По короткой стороне' },
];
// предел — services/tool_files.MAX_PDF_BYTES
const MAX_PDF_BYTES = 100 * 1024 * 1024;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Вылет, заложенный в файле: наименьшее расстояние от TrimBox до рамки вылетов, мм. */
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
  const pageOptions = (info.data?.pages ?? []).map((p) => ({ value: String(p.index), label: String(p.index) }));

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

  const reset = () => {
    setFile(null);
    setImage(null);
    setBackPage(null);
    setPageIndex(1);
  };

  return (
    <main className="page scroll-page">
      <div className="page-inner impose">
        <Link className="page-back" to="/tools">
          ← Все инструменты
        </Link>
        <PageHead
          eyebrow="Инструменты"
          title="Раскладка под печать"
          sub="PDF-макет на лист с метками реза. Цвета CMYK и плашки остаются как в файле — выгружайте макет из CorelDRAW в PDF. Файл на сервере не сохраняется."
        />
        <ToolsNotice />
        {!file && (
          <FileDrop
            accept=".pdf"
            hint="Перетащите сюда PDF-макет или выберите его"
            maxBytes={MAX_PDF_BYTES}
            onFile={setFile}
          />
        )}
        {file && info.isLoading && <div className="mx-empty">Читаю PDF…</div>}
        {file && info.isError && (
          <div className="ip-error" role="alert">
            {(info.error as Error).message}{' '}
            <button className="btn btn-ghost" type="button" onClick={reset}>
              Другой файл
            </button>
          </div>
        )}
        {file && info.data && page && trim && (
          <div className="ip-grid">
            <section className="ip-source">
              <div className="ip-row">
                <b>{file.name}</b>
                <button className="btn btn-ghost" type="button" onClick={reset}>
                  Другой файл
                </button>
              </div>
              {info.data.total > 1 && (
                <Field label="Лицо — страница">
                  <Select value={String(pageIndex)} options={pageOptions} onChange={(v) => setPageIndex(Number(v))} />
                </Field>
              )}
              {image ? (
                <PagePicker page={page} image={image} trim={trim} onTrim={setTrim} />
              ) : (
                <div className="mx-empty">Рисую страницу…</div>
              )}
              <p className="hint">
                Формат: {job?.item_w} × {job?.item_h} мм.{' '}
                {params.bleed === 0 && fileBleed(page.trim, page.bleed) === 0 && (
                  <span className="ip-warn">В файле нет вылетов — при резке по краю может остаться белая полоска.</span>
                )}
              </p>
            </section>

            <section className="ip-params">
              <Field label="Лист">
                <Select value={sheet} options={SHEET_OPTIONS} onChange={(v) => setSheet(v as SheetName)} />
              </Field>
              {sheet === 'custom' && (
                <div className="ip-pair">
                  <Field label="Ширина, мм">
                    <input
                      type="number"
                      min={10}
                      value={custom.w}
                      onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Высота, мм">
                    <input
                      type="number"
                      min={10}
                      value={custom.h}
                      onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })}
                    />
                  </Field>
                </div>
              )}
              <Field label="Непечатное поле, мм" hint="Захват печатной машины по краям листа">
                <input type="number" min={0} step={0.5} value={params.margin} onChange={num('margin')} />
              </Field>
              <Field label="Вылет, мм">
                <input type="number" min={0} step={0.5} value={params.bleed} onChange={num('bleed')} />
              </Field>
              <Field label="Рез">
                <Select
                  value={params.gap === 0 ? 'butt' : 'gap'}
                  options={CUT_OPTIONS}
                  onChange={(v) => setParams({ ...params, gap: v === 'butt' ? 0 : Math.max(4, params.bleed * 2) })}
                />
              </Field>
              {params.gap > 0 && (
                <Field label="Зазор, мм">
                  <input type="number" min={0} step={0.5} value={params.gap} onChange={num('gap')} />
                </Field>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={params.rotate}
                  onChange={(e) => setParams({ ...params, rotate: e.target.checked })}
                />
                Можно поворачивать
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={params.marks}
                  onChange={(e) => setParams({ ...params, marks: e.target.checked })}
                />
                Метки реза
              </label>
              {info.data.total > 1 && (
                <>
                  <Field label="Оборот — страница">
                    <Select
                      value={backPage ? String(backPage) : ''}
                      options={[{ value: '', label: 'Без оборота' }, ...pageOptions]}
                      onChange={(v) => setBackPage(v ? Number(v) : null)}
                    />
                  </Field>
                  {backPage && (
                    <Field label="Переворот листа">
                      <Select value={flip} options={FLIP_OPTIONS} onChange={(v) => setFlip(v as 'long' | 'short')} />
                    </Field>
                  )}
                </>
              )}
            </section>

            <section className="ip-result">
              {layout.isError && (
                <div className="ip-error" role="alert">
                  {(layout.error as Error).message}
                </div>
              )}
              {layout.data && image && (
                <>
                  <div className="ip-count">
                    <b>{layout.data.count}</b> шт. на листе · резов {layout.data.cuts.length}
                  </div>
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
