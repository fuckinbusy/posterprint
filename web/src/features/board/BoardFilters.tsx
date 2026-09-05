/* Полоса под шапкой: поиск, фильтр по видам работ и порядок карточек. */

import { useEffect, useRef } from 'react';

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
      <div className="filters" role="group" aria-label="Фильтр по виду работ">
        {items.map((item) => (
          <button
            className={item.key === templateKey ? 'active' : ''}
            key={item.key}
            type="button"
            onClick={() => onTemplateChange(item.key)}
          >
            {item.title}
          </button>
        ))}
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
