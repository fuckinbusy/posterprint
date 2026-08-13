/* Плитка раздела прайса. Одна и та же на главной странице и внутри
   раздела-родителя, где показываются его подразделы. */

import { TemplateIcon } from '@/components/Icons';
import { plural } from '@/lib/format';
import type { PriceGroup } from '@/types/api';

import { groupUnits } from './units';

/* Иконки стартовых разделов. Разделы, заведённые администратором, берут
   иконку из своего поля icon — здесь только те, что приходят из seed. */
const PRICE_ICONS: Record<string, string> = {
  print_color_sheet: 'printer',
  print_bw_sheet: 'doc',
  paper: 'doc',
  lamination: 'roll',
  binding: 'card',
  material_sqm: 'roll',
  finish_per_m: 'blade',
  cards_base: 'card',
  cards_paper_k: 'card',
  work: 'blade',
};

interface GroupTileProps {
  group: PriceGroup;
  /** сколько внутри подразделов — у раздела-родителя это главное число */
  childCount?: number;
  onOpen: (key: string) => void;
}

export function GroupTile({ group, childCount = 0, onOpen }: GroupTileProps) {
  const off = group.items.filter((item) => !item.active).length;

  return (
    <button className="pr-tile" type="button" onClick={() => onOpen(group.key)}>
      <span className="top">
        <span className="ic">
          <TemplateIcon name={PRICE_ICONS[group.key] ?? group.icon} />
        </span>
        {/* показываем единицы, которые реально есть в разделе:
            одна на всех больше не годится — они могут различаться */}
        {groupUnits(group.items, group.unit) && (
          <span className="unit">{groupUnits(group.items, group.unit)}</span>
        )}
      </span>
      <b>{group.title}</b>
      <span className="desc">{group.hint || ''}</span>
      <span className="foot">
        {/* У раздела с подразделами на виду должно быть их число: цены
            лежат внутри, и «0 позиций» на обложке пугало бы зря. */}
        {childCount > 0 ? (
          <>
            <span className="cnt">{childCount}</span>
            <span className="cnt-label">
              {plural(childCount, 'подраздел', 'подраздела', 'подразделов')}
            </span>
            {group.items.length > 0 && (
              <span className="off-cnt own">и свои: {group.items.length}</span>
            )}
          </>
        ) : (
          <>
            <span className="cnt">{group.items.length}</span>
            <span className="cnt-label">
              {plural(group.items.length, 'позиция', 'позиции', 'позиций')}
            </span>
            {off > 0 && <span className="off-cnt">{off} откл.</span>}
          </>
        )}
      </span>
    </button>
  );
}
