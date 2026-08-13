/* Полоса под шапкой: фильтр по видам работ и порядок карточек в колонках. */

import type { FormTemplate } from '@/types/api';

import type { BoardSort } from './sorting';

interface BoardFiltersProps {
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
  templates,
  templateKey,
  onTemplateChange,
  sort,
  onSortChange,
}: BoardFiltersProps) {
  const items = [{ key: 'all', title: 'Все работы' }, ...templates];

  return (
    <div className="filters-row">
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
      <label className="sort">
        <span>Порядок</span>
        <select
          aria-label="Порядок заказов в колонках"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as BoardSort)}
        >
          {SORT_OPTIONS.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
