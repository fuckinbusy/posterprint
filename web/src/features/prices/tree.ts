/* Двухуровневый прайс: раздел и его подразделы.

   Вложенность задана одним полем parent_key. Уровня ровно два — родителем
   может быть только раздел без собственного родителя. Дерево произвольной
   глубины потянуло бы за собой циклы, сирот и рекурсию везде, где раздел
   выбирают, а «Материалы → Бумага» решается и так.

   Раздел-родитель может держать и свои позиции: иначе для материала,
   который никуда не влез, пришлось бы заводить подраздел «Прочее». */

import type { PriceGroup } from '@/types/api';

export interface PriceBranch {
  group: PriceGroup;
  children: PriceGroup[];
}

/** Разделы верхнего уровня, у каждого — его подразделы.
 *
 *  Подраздел, потерявший родителя (например, тот удалён в обход интерфейса),
 *  не пропадает: показываем его как самостоятельный раздел. */
export function buildTree(groups: PriceGroup[]): PriceBranch[] {
  const keys = new Set(groups.map((g) => g.key));
  const isTop = (g: PriceGroup) => !g.parent_key || !keys.has(g.parent_key);

  return groups.filter(isTop).map((group) => ({
    group,
    children: groups.filter((g) => !isTop(g) && g.parent_key === group.key),
  }));
}

/** Куда можно вложить этот раздел: только разделы верхнего уровня.
 *
 *  Из списка убираем сам раздел и, если у него есть подразделы, — вообще
 *  всё: вложив его, мы получили бы третий уровень. */
export function possibleParents(groups: PriceGroup[], group: PriceGroup | null): PriceGroup[] {
  if (group && groups.some((g) => g.parent_key === group.key)) return [];
  return groups.filter(
    (g) => g.id !== null && !g.parent_key && (!group || g.key !== group.key),
  );
}

/** «Материалы › Бумага» — для подписей и выпадашек. */
export function groupPath(groups: PriceGroup[], group: PriceGroup): string {
  const parent = group.parent_key ? groups.find((g) => g.key === group.parent_key) : undefined;
  return parent ? `${parent.title} › ${group.title}` : group.title;
}
