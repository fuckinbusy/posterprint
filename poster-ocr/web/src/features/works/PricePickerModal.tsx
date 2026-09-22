/* Выбор раздела и позиции прайса — окном, а не выпадающим списком.

   Списком это работало, пока разделов было пять. Когда их полсотни, а
   часть ещё и вложена, выпадашка перестаёт быть выбором: в ней не видно
   ни цен, ни единиц, ни того, что лежит внутри раздела. Здесь то же самое,
   что на странице «Прайс», — плитки, вложенность, цены рядом с названием. */

import { useState } from 'react';

import { ModalShell, useModalFrame } from '@/app/ModalProvider';
import { ArrowIcon } from '@/components/Icons';
import { Empty } from '@/components/ui';
import { GroupTile } from '@/features/prices/GroupTile';
import { buildTree } from '@/features/prices/tree';
import { formatRate, plural } from '@/lib/format';
import type { PriceGroup } from '@/types/api';

interface PricePickerModalProps {
  /** «group» — нужен только раздел (список берёт из него все варианты),
   *  «item» — нужна конкретная позиция: галочка, платное количество */
  mode: 'group' | 'item';
  groups: PriceGroup[];
  currentGroup: string;
  currentItem?: string;
  onPick: (groupKey: string, itemKey?: string) => void;
  /** завести раздел или позицию, не выходя из конструктора */
  onCreateGroup?: () => void;
  onCreateItem?: (groupKey: string) => void;
}

export function PricePickerModal({
  mode,
  groups,
  currentGroup,
  currentItem,
  onPick,
  onCreateGroup,
  onCreateItem,
}: PricePickerModalProps) {
  const frame = useModalFrame();

  /* Открываем сразу на том разделе, который уже выбран: чаще всего сюда
   * заходят поправить позицию, а не искать раздел заново. */
  const [openKey, setOpenKey] = useState<string | null>(currentGroup || null);

  const tree = buildTree(groups);
  const open = openKey ? groups.find((g) => g.key === openKey) : undefined;
  const children = open ? groups.filter((g) => g.parent_key === open.key) : [];
  const parent = open?.parent_key ? groups.find((g) => g.key === open.parent_key) : undefined;

  const choose = (groupKey: string, itemKey?: string) => {
    onPick(groupKey, itemKey);
    frame.close();
  };

  /* ---------------------------------------------------- верхний уровень */
  if (!open) {
    return (
      <ModalShell
        eyebrow="Прайс"
        title={mode === 'group' ? 'Откуда брать варианты' : 'Откуда брать цену'}
        foot={
          <>
            {onCreateGroup && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  frame.close();
                  onCreateGroup();
                }}
              >
                + Новый раздел
              </button>
            )}
            <div className="spacer" />
            <button className="btn btn-ghost" type="button" onClick={frame.close}>
              Отмена
            </button>
          </>
        }
      >
        <p className="pr-hint" style={{ marginBottom: 16 }}>
          {mode === 'group'
            ? 'Сотрудник будет выбирать из позиций этого раздела. Цена возьмётся из выбранной.'
            : 'Выберите позицию — её цена и станет ставкой для этого поля.'}
        </p>

        {tree.length === 0 ? (
          <Empty>Разделов прайса пока нет</Empty>
        ) : (
          <div className="pr-tiles pick">
            {tree.map(({ group, children: kids }) => (
              <GroupTile
                group={group}
                childCount={kids.length}
                onOpen={() => setOpenKey(group.key)}
                key={group.key}
              />
            ))}
          </div>
        )}
      </ModalShell>
    );
  }

  /* ---------------------------------------------------- внутри раздела */
  const canPickThisGroup = mode === 'group' && open.items.length > 0;

  return (
    <ModalShell
      eyebrow={parent ? `Прайс · ${parent.title}` : 'Прайс'}
      title={open.title}
      foot={
        <>
          {mode === 'item' && onCreateItem && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                frame.close();
                onCreateItem(open.key);
              }}
            >
              + Новая позиция
            </button>
          )}
          {canPickThisGroup && (
            <button className="btn btn-green" type="button" onClick={() => choose(open.key)}>
              Взять этот раздел
            </button>
          )}
          <div className="spacer" />
          <button className="btn btn-ghost" type="button" onClick={frame.close}>
            Отмена
          </button>
        </>
      }
    >
      <button
        className="pr-back"
        type="button"
        onClick={() => setOpenKey(parent ? parent.key : null)}
      >
        <ArrowIcon /> {parent ? parent.title : 'Все разделы прайса'}
      </button>

      {children.length > 0 && (
        <section className="pr-sub">
          <h2>Подразделы</h2>
          <div className="pr-tiles pick">
            {children.map((child) => (
              <GroupTile group={child} onOpen={() => setOpenKey(child.key)} key={child.key} />
            ))}
          </div>
        </section>
      )}

      {mode === 'item' ? (
        <section>
          {children.length > 0 && <h2 className="pr-sub-title">Свои позиции</h2>}
          {open.items.length === 0 ? (
            <Empty>
              {children.length > 0
                ? 'Своих позиций нет — загляните в подразделы'
                : 'В разделе пока нет позиций'}
            </Empty>
          ) : (
            <div className="pick-items">
              {open.items.map((item) => (
                <button
                  className={
                    open.key === currentGroup && item.item_key === currentItem
                      ? 'pick-item on'
                      : 'pick-item'
                  }
                  type="button"
                  key={item.id}
                  onClick={() => choose(open.key, item.item_key)}
                >
                  <span className="nm">
                    <b>{item.title || item.item_key}</b>
                    <span className="key">
                      {item.item_key}
                      {item.active ? '' : ' · отключена'}
                    </span>
                  </span>
                  <span className="val">{formatRate(item.value, item.unit)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <p className="pr-hint">
          {open.items.length > 0
            ? `Здесь ${open.items.length} ${plural(open.items.length, 'позиция', 'позиции', 'позиций')} — нажмите «Взять этот раздел», и сотрудник будет выбирать из них.`
            : 'Своих позиций у раздела нет — выбирать сотруднику будет не из чего. Загляните в подразделы.'}
        </p>
      )}
    </ModalShell>
  );
}
