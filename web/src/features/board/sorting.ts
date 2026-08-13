/* Порядок карточек в колонке. Выбирается человеком в полосе фильтров. */

import { orderNumberKey } from '@/lib/format';
import type { Order } from '@/types/api';

/** Режимы сортировки. Тип живёт здесь, рядом с реализацией: раскладка и
 *  полоса фильтров только передают выбранное значение. */
export type BoardSort = 'due' | 'new_top' | 'new_bottom' | 'number_asc' | 'number_desc';

export const BOARD_SORTS: BoardSort[] = [
  'due',
  'new_top',
  'new_bottom',
  'number_asc',
  'number_desc',
];

type Comparator = (a: Order, b: Order) => number;

const SORTERS: Record<BoardSort, Comparator> = {
  // по сроку сдачи: ближайшие сверху, бессрочные в конце
  due: (a, b) => {
    if (!a.due_date && !b.due_date) return orderNumberKey(b.number) - orderNumberKey(a.number);
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  },
  new_top: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  new_bottom: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  number_asc: (a, b) => orderNumberKey(a.number) - orderNumberKey(b.number),
  number_desc: (a, b) => orderNumberKey(b.number) - orderNumberKey(a.number),
};

export function sortOrders(list: Order[], sort: BoardSort): Order[] {
  return [...list].sort(SORTERS[sort] ?? SORTERS.due);
}
