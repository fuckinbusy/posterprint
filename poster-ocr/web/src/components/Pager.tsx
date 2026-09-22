/* Переключатель страниц: 1 2 3 … 12

   Показывает не все номера подряд, а окно вокруг текущей страницы — иначе
   при сотне страниц полоса не помещается. */

import type { JSX } from 'react';

import { ArrowIcon, ArrowLeftIcon } from './Icons';

interface PagerProps {
  total: number;
  limit: number;
  offset: number;
  onGo: (offset: number) => void;
}

/** Сколько соседних номеров показывать слева и справа от текущего. */
const WINDOW = 2;

export function Pager({ total, limit, offset, onGo }: PagerProps) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;

  const current = Math.floor(offset / limit) + 1;

  const numbers = new Set([1, pages, current]);
  for (let d = 1; d <= WINDOW; d += 1) {
    if (current - d > 1) numbers.add(current - d);
    if (current + d < pages) numbers.add(current + d);
  }
  const sorted = [...numbers].sort((a, b) => a - b);

  const go = (page: number) => onGo((page - 1) * limit);
  const from = offset + 1;
  const to = Math.min(offset + limit, total);

  const cells: JSX.Element[] = [];
  let prev = 0;
  sorted.forEach((n) => {
    if (n - prev > 1) cells.push(<span className="pg-gap" key={`gap-${n}`}>…</span>);
    cells.push(
      <button
        className={n === current ? 'pg-num on' : 'pg-num'}
        type="button"
        key={n}
        onClick={() => go(n)}
      >
        {n}
      </button>,
    );
    prev = n;
  });

  return (
    <div className="pager">
      <button
        className="pg-arrow"
        type="button"
        title="Назад"
        disabled={current === 1}
        onClick={() => go(current - 1)}
      >
        <ArrowLeftIcon />
      </button>
      {cells}
      <button
        className="pg-arrow"
        type="button"
        title="Вперёд"
        disabled={current === pages}
        onClick={() => go(current + 1)}
      >
        <ArrowIcon />
      </button>
      <span className="pg-info">
        {from}–{to} из {total}
      </span>
    </div>
  );
}
