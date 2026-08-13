/* Создание раздела или позиции прайса прямо в строке конструктора.

   Смысл в том, чтобы не уходить в раздел «Прайс» на середине настройки:
   администратор доводит вид работ до конца за один заход. */

import { useState } from 'react';

import { createPriceGroup, createPriceItem, usePricesInvalidation } from '@/api/prices';
import { useToast } from '@/app/ToastProvider';
import { PRICE_UNITS, unitOptions } from '@/features/prices/units';
import type { PriceGroup } from '@/types/api';

import type { QuickMode } from './WorkFieldRow';

interface QuickPriceFormProps {
  mode: QuickMode;
  /** раздел, в который добавляется позиция (для mode = 'item') */
  group?: PriceGroup;
  onCancel: () => void;
  /** создано: ключ раздела или ключ позиции */
  onCreated: (key: string) => void;
}

export function QuickPriceForm({ mode, group, onCancel, onCreated }: QuickPriceFormProps) {
  const { toast, toastError } = useToast();
  const invalidate = usePricesInvalidation();

  const isFactor = group?.kind === 'factor';
  const [title, setTitle] = useState('');
  // для новой позиции — единица раздела, для нового раздела — разовая сумма
  const [unit, setUnit] = useState(mode === 'item' ? (group?.unit ?? '₽') : '₽');
  const [value, setValue] = useState(isFactor ? '1.5' : '500');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const name = title.trim();
    if (!name) {
      toast('Укажите название');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'group') {
        const created = await createPriceGroup({
          title: name,
          hint: '',
          unit,
          kind: unit === '×' ? 'factor' : 'money',
        });
        toast(`Раздел «${name}» создан`);
        invalidate();
        onCreated(created.key);
      } else {
        if (!group) return;
        // ключ позиции = название: под этим ключом расчёт ищет цену
        await createPriceItem({
          group_key: group.key,
          item_key: name,
          value: Number(value || 0),
          unit,
        });
        toast(`«${name}» добавлена в прайс`);
        invalidate();
        onCreated(name);
      }
    } catch (e) {
      toastError(e);
      setSaving(false);
    }
  };

  if (mode === 'group') {
    return (
      <div className="wk-quick">
        <div className="wk-quick-title">Новый раздел прайса</div>
        <div className="wk-quick-row">
          <label className="wk-cell">
            <span>Название</span>
            <input
              type="text"
              autoFocus
              value={title}
              placeholder="Например: Срочность"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="wk-cell">
            <span>Единица по умолчанию</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {PRICE_UNITS.map((u) => (
                <option value={u.value} key={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-green" type="button" disabled={saving} onClick={save}>
            Создать
          </button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>
            Отмена
          </button>
        </div>
        <div className="wk-quick-hint">
          «×» — для коэффициентов вроде 1.5 (плюс 50%). Остальные — для сумм в рублях.
        </div>
      </div>
    );
  }

  return (
    <div className="wk-quick">
      <div className="wk-quick-title">Новая позиция в разделе «{group?.title ?? ''}»</div>
      <div className="wk-quick-row">
        <label className="wk-cell">
          <span>Название</span>
          <input
            type="text"
            autoFocus
            value={title}
            placeholder="Например: Срочный заказ"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="wk-cell">
          <span>{isFactor ? 'Коэффициент' : 'Значение'}</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {!isFactor && (
          <label className="wk-cell">
            <span>За что берётся</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {unitOptions(unit).map((u) => (
                <option value={u.value} key={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn btn-green" type="button" disabled={saving} onClick={save}>
          Создать
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
      <div className="wk-quick-hint">
        {isFactor
          ? '1.5 — цена вырастет наполовину, 2 — вдвое.'
          : 'Цену потом можно поменять в разделе «Прайс» — она подтянется сюда сама.'}
      </div>
    </div>
  );
}
