/* Шрифты: поиск по снимку каталога Google Fonts (без интернета), скачивание
   TTF архивом с установщиком, переход на fonts-online.ru, если в Google
   шрифта нет, и разбор .cdr — какие шрифты нужны макету.

   Живого превью шрифта нет намеренно: CSP системы не пускает чужие стили и
   шрифты в страницу, а тянуть их через сервер ради картинки — лишний трафик
   до Google, который и так медленный. Название, категория и наборы
   символов видны; начертания — галочками. */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { fontsDownload, fontsFromCdr, fontsSearch, type CdrFont, type FontFamily } from '@/api/tools';
import { useToast } from '@/app/ToastProvider';
import { Select } from '@/components/Select';
import { Empty, Field, PageHead, Section } from '@/components/ui';
import { FileDrop } from '@/features/tools/FileDrop';
import { fontsOnlineSearch } from '@/features/tools/tools';
import { ToolsNotice } from '@/features/tools/ToolsNotice';

const CATEGORIES = [
  { value: '', label: 'Все категории' },
  { value: 'Sans Serif', label: 'Без засечек' },
  { value: 'Serif', label: 'С засечками' },
  { value: 'Display', label: 'Акцидентные' },
  { value: 'Handwriting', label: 'Рукописные' },
  { value: 'Monospace', label: 'Моноширинные' },
];
const STYLE_LABELS: Record<string, string> = { '400': 'Обычный', '700': 'Жирный', '400i': 'Курсив', '700i': 'Жирный курсив' };
const SUBSET_LABELS: Record<string, string> = { cyrillic: 'кириллица', 'cyrillic-ext': 'кириллица расш.', latin: 'латиница', 'latin-ext': 'латиница расш.', greek: 'греческий', vietnamese: 'вьетнамский' };
const MAX_CDR_BYTES = 300 * 1024 * 1024;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Карточка семейства: начертания галочками и «Скачать». */
function FamilyRow({ font }: { font: FontFamily }) {
  const { toast } = useToast();
  const common = ['400', '700', '400i', '700i'].filter((s) => font.variants.includes(s));
  const [styles, setStyles] = useState<string[]>(() => common.filter((s) => s === '400' || s === '700'));
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = all ? font.variants : styles;

  const download = async () => {
    if (chosen.length === 0) {
      toast('Выберите хотя бы одно начертание');
      return;
    }
    setBusy(true);
    try {
      const blob = await fontsDownload(font.family, chosen);
      if (!blob) {
        toast('Не удалось скачать: Google Fonts недоступен с сервера. Попробуйте позже или fonts-online.ru');
        return;
      }
      saveBlob(blob, `${font.family}.zip`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="font-row">
      <div className="font-main">
        <b>{font.family}</b>
        <div className="font-tags">
          <span>{CATEGORIES.find((c) => c.value === font.category)?.label ?? font.category}</span>
          {font.subsets.filter((s) => SUBSET_LABELS[s]).map((s) => (
            <span key={s} className={s.startsWith('cyrillic') ? 'on' : ''}>
              {SUBSET_LABELS[s]}
            </span>
          ))}
          <span>{font.variants.length} начерт.</span>
        </div>
      </div>
      <div className="font-styles">
        {common.map((s) => (
          <label className="check" key={s}>
            <input
              type="checkbox"
              checked={all || styles.includes(s)}
              disabled={all}
              onChange={(e) => setStyles(e.target.checked ? [...styles, s] : styles.filter((x) => x !== s))}
            />
            {STYLE_LABELS[s]}
          </label>
        ))}
        {font.variants.length > common.length && (
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Все {font.variants.length}
          </label>
        )}
      </div>
      <button className="btn btn-green" type="button" disabled={busy} onClick={() => void download()}>
        {busy ? 'Скачиваю…' : 'Скачать zip'}
      </button>
    </div>
  );
}

const STATUS: Record<CdrFont['status'], string> = { system: 'Системный', google: 'Есть в Google Fonts', unknown: 'Не найден' };

export function FontsTool() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cyrillic, setCyrillic] = useState(true);
  const [category, setCategory] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const result = useQuery({
    queryKey: ['fonts', debounced, cyrillic, category],
    queryFn: () => fontsSearch(debounced, cyrillic, category),
    placeholderData: (prev) => prev,
  });

  const [cdrFile, setCdrFile] = useState<File | null>(null);
  const cdr = useQuery({
    queryKey: ['fonts-cdr', cdrFile?.name, cdrFile?.size, cdrFile?.lastModified],
    queryFn: () => fontsFromCdr(cdrFile!),
    enabled: Boolean(cdrFile),
    retry: false,
  });

  const downloadCdrFont = async (font: CdrFont) => {
    if (!font.google) return;
    const styles = ['400', '700'].filter((s) => font.google!.variants.includes(s));
    const blob = await fontsDownload(font.google.family, styles.length ? styles : font.google.variants.slice(0, 2));
    if (!blob) {
      toast('Не удалось скачать: Google Fonts недоступен с сервера');
      return;
    }
    saveBlob(blob, `${font.google.family}.zip`);
  };

  return (
    <main className="page scroll-page">
      <div className="page-inner fonts">
        <Link className="page-back" to="/tools">
          ← Все инструменты
        </Link>
        <PageHead
          eyebrow="Инструменты"
          title="Шрифты"
          sub="Google Fonts — открытые лицензии, можно печатать и продавать. В архиве — TTF, установщик для Windows и заметка о лицензии."
        />
        <ToolsNotice />

        <Section title="Найти в Google Fonts">
          <div className="fonts-search">
            <Field label="Название">
              <input type="search" value={q} placeholder="Например: Montserrat, Roboto, Lobster" onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label="Категория">
              <Select value={category} options={CATEGORIES} onChange={setCategory} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={cyrillic} onChange={(e) => setCyrillic(e.target.checked)} />
              Только с кириллицей
            </label>
          </div>
          {result.isError && <div className="ip-error">{(result.error as Error).message}</div>}
          {result.data && (
            <>
              <p className="hint">
                Показано {result.data.families.length} из {result.data.total}
                {result.data.total > result.data.families.length ? ' — уточните название' : ''}.
              </p>
              {result.data.families.length === 0 ? (
                <Empty>В Google Fonts такого нет.</Empty>
              ) : (
                <div className="font-list">
                  {result.data.families.map((f) => (
                    <FamilyRow font={f} key={f.family} />
                  ))}
                </div>
              )}
            </>
          )}
          <div className="page-actions">
            <a className="btn btn-ghost" href={fontsOnlineSearch(q.trim())} target="_blank" rel="noreferrer">
              Искать «{q.trim() || 'шрифт'}» на fonts-online.ru ↗
            </a>
            <span className="hint">Оттуда скачивайте сами: сайт запрещает качать программой.</span>
          </div>
        </Section>

        <Section title="Шрифты из макета .cdr">
          <p className="hint">Загрузите макет — покажем, какие шрифты в нём используются и где их взять. Файл на сервере не остаётся.</p>
          <FileDrop accept=".cdr" hint="Перетащите сюда файл .cdr или выберите его" maxBytes={MAX_CDR_BYTES} onFile={setCdrFile} />
          {cdrFile && cdr.isLoading && <div className="mx-empty">Читаю {cdrFile.name}…</div>}
          {cdr.isError && <div className="ip-error">{(cdr.error as Error).message}</div>}
          {cdr.data && (
            <>
              <p className="hint">
                {cdrFile?.name}
                {cdr.data.version ? ` · ${cdr.data.version.label}` : ''}
                {cdr.data.note ? ` · ${cdr.data.note}` : ''}
              </p>
              {cdr.data.fonts.length > 0 && (
                <div className="font-list">
                  {cdr.data.fonts.map((f) => (
                    <div className="font-row" key={f.name}>
                      <div className="font-main">
                        <b>{f.name}</b>
                        <div className="font-tags">
                          <span className={f.status === 'google' ? 'on' : f.status === 'unknown' ? 'bad' : ''}>{STATUS[f.status]}</span>
                        </div>
                      </div>
                      {f.status === 'system' && <span className="hint">Есть в Windows — ставить не нужно</span>}
                      {f.status === 'google' && (
                        <button className="btn btn-green" type="button" onClick={() => void downloadCdrFont(f)}>
                          Скачать zip
                        </button>
                      )}
                      {f.status === 'unknown' && (
                        <a className="btn btn-ghost" href={fontsOnlineSearch(f.name)} target="_blank" rel="noreferrer">
                          Искать на fonts-online.ru ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>
      </div>
    </main>
  );
}
