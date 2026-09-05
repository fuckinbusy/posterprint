/* Полоса под шапкой: поиск, фильтр по видам работ и порядок карточек. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { SearchIcon } from '@/components/Icons';
import { Select } from '@/components/Select';
import type { FormTemplate } from '@/types/api';

import type { BoardSort } from './sorting';

interface BoardFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  templates: FormTemplate[];
  templateKey: string;
  onTemplateChange: (key: string) => void;
  sort: BoardSort;
  onSortChange: (sort: BoardSort) => void;
}

const SORT_OPTIONS: { value: BoardSort; label: string }[] = [
  { value: 'due', label: 'По сроку сдачи' },
  { value: 'new_top', label: 'Новые сверху' },
  { value: 'new_bottom', label: 'Новые снизу' },
  { value: 'number_asc', label: 'По номеру ↑' },
  { value: 'number_desc', label: 'По номеру ↓' },
];

/* Виды работ — в одну строку. Сколько чипов помещается, меряем по факту;
   остальные уходят в список «Ещё N». С полусотней видов не годится ни
   прокрутка (половина за краем без всякого намёка), ни перенос на несколько
   строк (съедает у доски пол-экрана). Выбранный вид виден чипом всегда,
   даже если по порядку он не влез. */
const CHIP_GAP = 8;
/* место под кнопку «Ещё N» — с запасом на двузначное число */
const MORE_ROOM = 118;

interface ChipFit {
  widths: number[];
  room: number;
}

function useChipFit(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<ChipFit | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const chips = [...el.querySelectorAll<HTMLButtonElement>(':scope > button')];
      // скрытые чипы ширины не имеют — на миг показываем все, меряем,
      // возвращаем как было (React сам поправит после перерисовки)
      const was = chips.map((c) => c.hidden);
      chips.forEach((c) => {
        c.hidden = false;
      });
      const widths = chips.map((c) => c.offsetWidth);
      chips.forEach((c, i) => {
        c.hidden = was[i];
      });
      const room = el.clientWidth;
      setFit((prev) =>
        prev && prev.room === room && prev.widths.every((w, i) => w === widths[i]) && prev.widths.length === widths.length
          ? prev
          : { widths, room },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => observer.disconnect();
  }, [count]);

  return { ref, fit };
}

/** Какие чипы показать: все, если влезают; иначе — сколько поместится по
 *  порядку плюс выбранный. */
function visibleChips(keys: string[], selected: string, fit: ChipFit | null): Set<string> {
  const all = new Set(keys);
  if (!fit || fit.widths.length !== keys.length) return all;
  const { widths, room } = fit;
  const total = widths.reduce((acc, w) => acc + w, 0) + CHIP_GAP * (widths.length - 1);
  if (total <= room) return all;

  const shown = new Set<string>();
  const limit = room - MORE_ROOM - CHIP_GAP;
  const selectedIdx = keys.indexOf(selected);
  let used = 0;
  if (selectedIdx >= 0) {
    shown.add(selected);
    used = widths[selectedIdx];
  }
  for (let i = 0; i < keys.length; i += 1) {
    if (shown.has(keys[i])) continue;
    const w = widths[i] + (used ? CHIP_GAP : 0);
    if (used + w > limit) break;
    used += w;
    shown.add(keys[i]);
  }
  return shown;
}

export function BoardFilters({
  query,
  onQueryChange,
  templates,
  templateKey,
  onTemplateChange,
  sort,
  onSortChange,
}: BoardFiltersProps) {
  const items = [{ key: 'all', title: 'Все работы' }, ...templates];
  const searchRef = useRef<HTMLInputElement>(null);
  const chips = useChipFit(items.length);
  const shown = visibleChips(
    items.map((i) => i.key),
    templateKey,
    chips.fit,
  );
  const rest = items.filter((item) => !shown.has(item.key));

  // «/» — быстрый переход в поиск. Не перехватываем, если человек уже
  // печатает в каком-нибудь поле: слэш там нужен как символ.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement;
      if (typing) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="filters-row">
      <div className="tb-search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Номер, клиент, телефон…"
          autoComplete="off"
          aria-label="Поиск заказов"
          ref={searchRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      <div className="filters" role="group" aria-label="Фильтр по виду работ" ref={chips.ref}>
        {items.map((item) => (
          <button
            className={item.key === templateKey ? 'active' : ''}
            key={item.key}
            type="button"
            hidden={!shown.has(item.key)}
            onClick={() => onTemplateChange(item.key)}
          >
            {item.title}
          </button>
        ))}
        {rest.length > 0 && (
          <Select
            variant="pill"
            className="filters-more"
            aria-label="Остальные виды работ"
            value=""
            placeholder={`Ещё ${rest.length}`}
            options={rest.map((item) => ({ value: item.key, label: item.title }))}
            onChange={onTemplateChange}
          />
        )}
      </div>
      <div className="sort">
        <span>Порядок</span>
        <Select
          variant="pill"
          aria-label="Порядок заказов в колонках"
          value={sort}
          options={SORT_OPTIONS}
          onChange={(v) => onSortChange(v as BoardSort)}
        />
      </div>
    </div>
  );
}
