/* Один раздел прайса: строки позиций. */

import { useState } from 'react';

import {
  createPriceItem,
  deletePriceGroup,
  deletePriceItem,
  updatePriceItem,
  usePricesInvalidation,
} from '@/api/prices';
import { useAuth, useCan } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { ArrowIcon, EyeIcon, EyeOffIcon, MoveIcon, TrashIcon } from '@/components/Icons';
import { Empty, PageHead } from '@/components/ui';
import { formatRate, plural } from '@/lib/format';
import type { PriceGroup, PriceItem } from '@/types/api';

import { GroupTile } from './GroupTile';
import { MoveItemModal } from './MoveItemModal';
import { PriceGroupEditor } from './PriceGroupEditor';
import { groupUnits, unitOptions } from './units';

/** Почему раздел нельзя удалить. Пустая строка — можно.
 *
 *  Причину показываем и в подсказке к кнопке, и строкой на странице:
 *  всплывающую подсказку на выключенной кнопке многие браузеры не
 *  показывают вовсе, а знать причину нужно. */
function deleteBlockedBy(group: PriceGroup, children: PriceGroup[] = []): string {
  if (group.system) return 'Это системный раздел — его нельзя удалить.';
  if (children.length > 0) {
    return `Внутри лежат подразделы: ${children
      .map((c) => c.title)
      .join(', ')}. Сначала удалите или перенесите их.`;
  }
  if (group.used_by.length > 0) {
    return `Раздел занят видами работ: ${group.used_by.join(', ')}. Чтобы удалить, переведите их поля на другой раздел.`;
  }
  if (group.in_use) return 'Раздел используется в видах работ.';
  return '';
}

export function PriceGroupView({
  group,
  groups,
  onOpen,
}: {
  group: PriceGroup;
  /** весь справочник — нужен для подразделов и переноса позиций */
  groups: PriceGroup[];
  /** открыть другой раздел; null — вернуться к списку всех разделов */
  onOpen: (key: string | null) => void;
}) {
  const can = useCan();
  const modal = useModal();
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();
  const invalidate = usePricesInvalidation();

  const editable = can('prices.edit');
  const [adding, setAdding] = useState(false);
  const parent = group.parent_key ? groups.find((g) => g.key === group.parent_key) : undefined;
  const children = groups.filter((g) => g.parent_key === group.key);

  const removeGroup = async () => {
    if (group.id === null) return;
    const ok = await askConfirm({
      eyebrow: 'Прайс',
      title: 'Удалить раздел?',
      text: [
        <>
          Раздел <b>{group.title}</b> будет удалён.
        </>,
        <>
          Вместе с ним пропадут все его позиции — {group.items.length}{' '}
          {plural(group.items.length, 'штука', 'штуки', 'штук')}.
        </>,
      ],
      yes: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    try {
      await deletePriceGroup(group.id);
      toast('Раздел удалён');
      invalidate();
      // из подраздела возвращаемся к родителю, а не на самый верх
      onOpen(parent ? parent.key : null);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        {/* Из подраздела шаг назад ведёт к родителю: это ближайший уровень,
            откуда сюда пришли, а не самый верх. */}
        <button className="pr-back" type="button" onClick={() => onOpen(parent ? parent.key : null)}>
          <ArrowIcon /> {parent ? parent.title : 'Все разделы прайса'}
        </button>

        <PageHead
          eyebrow={
            /* видно, внутри чего лежит подраздел: без этого «Баннер» на своей
               странице ничем не отличается от самостоятельного раздела */
            /* Единицу берём ту, что реально стоит у позиций, а не единицу
               раздела: в «Доп обработке» лежат и ₽/пог.м, и ₽/шт, а шапка
               писала одно «₽/пог.м». Плитка на общей странице считает так же
               (GroupTile) — теперь совпадают. */
            [
              parent ? `Прайс · ${parent.title}` : 'Прайс',
              groupUnits(group.items ?? [], group.unit),
            ]
              .filter(Boolean)
              .join(' · ')
          }
          title={group.title}
          sub={group.hint || undefined}
          actions={
            editable && (
              <>
                <button className="btn btn-green" type="button" onClick={() => setAdding((v) => !v)}>
                  + Добавить позицию
                </button>
                {/* Заводить подраздел изнутри родителя — то, как об этом
                    думают: «создаю Материалы, а в них Дерево и Пластик».
                    В редакторе раздела выбирается родитель, а это обратный
                    ход, и его легко прочитать наоборот. */}
                {!group.parent_key && (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() =>
                      modal.open(
                        <PriceGroupEditor group={null} groups={groups} parentKey={group.key} />,
                      )
                    }
                  >
                    + Подраздел
                  </button>
                )}
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => modal.open(<PriceGroupEditor group={group} groups={groups} />)}
                >
                  Настроить раздел
                </button>
                {/* Кнопку показываем всегда. Раньше она просто исчезала у
                    занятого раздела, и понять, правило это или поломка, было
                    невозможно. Теперь она выключена и объясняет, что мешает. */}
                {group.id !== null && (
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={group.system || group.in_use || children.length > 0}
                    title={deleteBlockedBy(group, children) || 'Удалить раздел вместе с позициями'}
                    onClick={removeGroup}
                  >
                    Удалить раздел
                  </button>
                )}
              </>
            )
          }
        />

        {editable && deleteBlockedBy(group, children) && (
          <div className="pr-note locked">{deleteBlockedBy(group, children)}</div>
        )}

        {/* Подразделы плитками прямо здесь. Раньше они были разложены на
            главной странице, а сюда приходили за ними и находили пустоту. */}
        {children.length > 0 && (
          <section className="pr-sub">
            <h2>Подразделы</h2>
            <div className="pr-tiles">
              {children.map((child) => (
                <GroupTile group={child} onOpen={(key) => onOpen(key)} key={child.key} />
              ))}
            </div>
          </section>
        )}

        {/* Когда есть подразделы, цены обычно лежат в них — отделяем
            собственные позиции раздела заголовком, чтобы пустой список
            ниже не читался как «страница пустая». */}
        {children.length > 0 && <h2 className="pr-sub-title">Свои позиции</h2>}

        {editable ? (
          <>
            <div className="pr-note">
              Ключ позиции должен совпадать с вариантом в шаблоне заказа, иначе расчёт её не найдёт.
              Название можно менять свободно. Значение сохраняется по Enter или когда уходите из
              поля. Единица — у каждой позиции своя: в одном разделе спокойно уживаются цена за
              метр и цена за штуку.
            </div>
            {adding && <AddItemForm group={group} onDone={() => setAdding(false)} />}
          </>
        ) : (
          <div className="pr-note">Только просмотр. Изменение цен доступно администратору.</div>
        )}

        {group.items.length === 0 ? (
          <Empty>
            {children.length > 0
              ? 'Своих позиций нет — цены лежат в подразделах выше'
              : 'В разделе пока нет позиций'}
          </Empty>
        ) : (
          <div className="pr-rows">
            {group.items.map((item) =>
              editable ? (
                <EditableRow key={item.id} item={item} group={group} groups={groups} />
              ) : (
                <div className={item.active ? 'pr-row read' : 'pr-row read off'} key={item.id}>
                  <span className="nm">
                    <b>{item.title}</b>
                    <span className="key">
                      {item.item_key}
                      {item.active ? '' : ' · отключена'}
                    </span>
                  </span>
                  <span className="val-read">{formatRate(item.value, item.unit)}</span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/* ---------------------------------------------------- строка на правку */
/** Значение сохраняется, когда уходят из поля или жмут Enter.
 *
 *  Отправляем только то, что реально изменилось: администратор часто просто
 *  проходит табом по строкам, и запрос на каждое поле без изменений — это
 *  лишняя запись «менял такой-то» в истории позиции. */
function EditableRow({
  item,
  group,
  groups,
}: {
  item: PriceItem;
  group: PriceGroup;
  groups: PriceGroup[];
}) {
  const modal = useModal();
  const { session } = useAuth();
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();
  const invalidate = usePricesInvalidation();

  const [title, setTitle] = useState(item.title);
  const [value, setValue] = useState(String(item.value));
  const [saved, setSaved] = useState(false);

  const commit = async (field: 'title' | 'value') => {
    const next = field === 'title' ? title.trim() : Number(value || 0);
    const current = field === 'title' ? item.title : item.value;
    if (String(next) === String(current)) return;

    try {
      await updatePriceItem(item.id, { [field]: next, author: session?.name ?? '' });
      invalidate();
      if (field === 'value') {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 900);
      }
    } catch (e) {
      toastError(e);
    }
  };

  /** Единица сохраняется сразу: это выбор из списка, ждать ухода из поля
   *  незачем — и легко забыть, что выбор не записан. */
  const changeUnit = async (unit: string) => {
    try {
      await updatePriceItem(item.id, { unit, author: session?.name ?? '' });
      invalidate();
    } catch (e) {
      toastError(e);
    }
  };

  const toggle = async () => {
    try {
      await updatePriceItem(item.id, { active: !item.active });
      invalidate();
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    const ok = await askConfirm({
      eyebrow: 'Прайс',
      title: 'Удалить позицию?',
      text: (
        <>
          <b>{item.title}</b> исчезнет из прайса и из списков в форме заказа.
        </>
      ),
      note: 'Если позиция временно не нужна, её можно отключить «глазом» — настройки сохранятся.',
      yes: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    try {
      await deletePriceItem(item.id);
      toast('Позиция удалена');
      invalidate();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className={item.active ? 'pr-row' : 'pr-row off'}>
      <span className="nm">
        <input
          type="text"
          value={title}
          aria-label="Название позиции"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void commit('title')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span className="key">
          {item.item_key}
          {item.updated_by ? ` · менял ${item.updated_by}` : ''}
          {/* видно сразу, что позицию держит вид работ — не надо тыкать
              в выключенную корзину, чтобы это выяснить */}
          {item.used_by.length > 0 && (
            <em className="locked-by"> · занята: {item.used_by.join(', ')}</em>
          )}
        </span>
      </span>
      <input
        className={saved ? 'val saved' : 'val'}
        type="number"
        step="0.01"
        min="0"
        value={value}
        aria-label="Значение"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit('value')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {/* В строке места мало — показываем сам символ, а расшифровку кладём
          в подсказку и в широкие формы, где она помещается целиком. */}
      <select
        className="unit-pick"
        value={item.unit}
        aria-label="За что берётся цена"
        title={unitOptions(item.unit).find((u) => u.value === item.unit)?.label ?? 'За что берётся цена'}
        onChange={(e) => void changeUnit(e.target.value)}
      >
        {unitOptions(item.unit).map((unit) => (
          <option value={unit.value} key={unit.value} title={unit.label}>
            {unit.value}
          </option>
        ))}
      </select>
      <button
        className="pr-act"
        type="button"
        title="Перенести в другой раздел"
        onClick={() => modal.open(<MoveItemModal item={item} source={group} groups={groups} />)}
      >
        <MoveIcon />
      </button>
      <button
        className="pr-act"
        type="button"
        title={item.active ? 'Отключить' : 'Включить'}
        onClick={toggle}
      >
        {item.active ? <EyeIcon /> : <EyeOffIcon />}
      </button>
      <button
        className="pr-act del"
        type="button"
        disabled={item.used_by.length > 0}
        title={
          item.used_by.length > 0
            ? `Позицию держат виды работ: ${item.used_by.join(', ')}. Её можно отключить «глазом».`
            : 'Удалить'
        }
        onClick={remove}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/* ---------------------------------------------------- новая позиция */
function AddItemForm({ group, onDone }: { group: PriceGroup; onDone: () => void }) {
  const { session } = useAuth();
  const { toast, toastError } = useToast();
  const invalidate = usePricesInvalidation();

  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('0');
  // по умолчанию — единица раздела, но её можно сменить прямо здесь
  const [unit, setUnit] = useState(group.unit);

  const save = async () => {
    if (!key.trim()) {
      toast('Укажите ключ позиции');
      return;
    }
    try {
      await createPriceItem({
        group_key: group.key,
        item_key: key.trim(),
        title: title.trim(),
        value: Number(value || 0),
        unit,
        author: session?.name ?? '',
      });
      toast(`«${key.trim()}» добавлена в прайс`);
      invalidate();
      onDone();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="pr-add">
      <div className="field">
        <label>Ключ (как в шаблоне заказа)</label>
        <input
          type="text"
          autoFocus
          value={key}
          placeholder="Например: Баннер 650 г"
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Название</label>
        <input
          type="text"
          value={title}
          placeholder="Можно оставить пустым"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field small">
        <label>Значение</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div className="field">
        <label>За что берётся</label>
        <select value={unit} onChange={(e) => setUnit(e.target.value)}>
          {unitOptions(unit).map((u) => (
            <option value={u.value} key={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-green" type="button" onClick={save}>
        Добавить
      </button>
    </div>
  );
}
