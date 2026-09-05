/* Создание и настройка раздела прайса. */

import { useState } from 'react';

import { createPriceGroup, updatePriceGroup, usePricesInvalidation } from '@/api/prices';
import { ModalShell, useModalFrame, useUnsavedGuard } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Field, Section } from '@/components/ui';
import { Select } from '@/components/Select';
import type { PriceGroup, PriceGroupKind } from '@/types/api';

import { possibleParents } from './tree';
import { unitOptions } from './units';


export function PriceGroupEditor({
  group,
  groups = [],
  parentKey = '',
}: {
  group: PriceGroup | null;
  /** весь справочник — нужен, чтобы выбрать раздел-родителя */
  groups?: PriceGroup[];
  /** заранее выбранный родитель — когда заводят подраздел изнутри раздела */
  parentKey?: string;
}) {
  const frame = useModalFrame();
  const { toast, toastError } = useToast();
  const invalidate = usePricesInvalidation();

  const isNew = !group;
  const [title, setTitle] = useState(group?.title ?? '');
  const [hint, setHint] = useState(group?.hint ?? '');
  const [unit, setUnit] = useState(group?.unit ?? '₽/м');
  const [kind, setKind] = useState<PriceGroupKind>(group?.kind ?? 'money');
  const [parent, setParent] = useState(group?.parent_key ?? parentKey);
  const [saving, setSaving] = useState(false);

  const [initialJson] = useState(() => JSON.stringify([title, hint, unit, kind, parent]));
  const markClean = useUnsavedGuard(JSON.stringify([title, hint, unit, kind, parent]) !== initialJson);

  const parents = possibleParents(groups, group);
  // у раздела уже есть свои подразделы — вложить его некуда, будет третий уровень
  const hasChildren = Boolean(group && groups.some((g) => g.parent_key === group.key));

  const units = unitOptions(unit);

  const save = async () => {
    if (!title.trim()) {
      toast('Укажите название раздела');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        hint: hint.trim(),
        unit: unit || '₽',
        kind,
        parent_key: parent,
      };
      if (isNew) await createPriceGroup(payload);
      else await updatePriceGroup(group.id as number, payload);
      toast(isNew ? `Раздел «${title.trim()}» создан` : 'Сохранено');
      invalidate();
      markClean();
      frame.close();
    } catch (e) {
      toastError(e);
      setSaving(false);
    }
  };

  return (
    <ModalShell
      eyebrow={isNew ? 'Прайс' : `Раздел · ${group.title}`}
      title={
        isNew
          ? parentKey
            ? `Подраздел в «${groups.find((g) => g.key === parentKey)?.title ?? ''}»`
            : 'Новый раздел'
          : 'Настройка раздела'
      }
      foot={
        <>
          <button className="btn btn-ghost" type="button" onClick={frame.close}>
            Отмена
          </button>
          <div className="spacer" />
          <button className="btn btn-green" type="button" disabled={saving} onClick={save}>
            {isNew ? 'Создать' : 'Сохранить'}
          </button>
        </>
      }
    >
      <Section title="Раздел прайса">
        <div className="grid">
          <Field label="Название">
            <input
              type="text"
              value={title}
              placeholder="Например: Гравировка: материалы"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field
            label="Единица по умолчанию"
            hint="Подставляется новым позициям раздела. У каждой позиции единица своя — в одном разделе спокойно уживаются цена за метр и цена за штуку. На расчёт не влияет: способ счёта задаёт роль поля в виде работ."
          >
            <Select
              value={unit}
              options={units.map((u) => ({ value: u.value, label: u.label }))}
              onChange={setUnit}
            />
          </Field>
        </div>

        <div className="grid one" style={{ marginTop: 13 }}>
          <Field label="Пояснение">
            <input
              type="text"
              value={hint}
              placeholder="Что здесь лежит и как считается"
              onChange={(e) => setHint(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid one" style={{ marginTop: 13 }}>
          <Field
            label={`Вложить «${title.trim() || 'этот раздел'}» внутрь`}
            hint={
              hasChildren
                ? 'У этого раздела есть свои подразделы, поэтому вложить его никуда нельзя — уровня всего два.'
                : 'Здесь выбирается РОДИТЕЛЬ. Чтобы наоборот — положить что-то внутрь этого раздела, откройте его и нажмите «+ Подраздел».'
            }
          >
            <Select
              value={parent}
              disabled={hasChildren}
              options={[
                { value: '', label: '— никуда, это самостоятельный раздел —' },
                ...parents.map((g) => ({ value: g.key, label: `внутрь «${g.title}»` })),
              ]}
              onChange={setParent}
            />
          </Field>
        </div>

        <div className="grid one" style={{ marginTop: 13 }}>
          <Field
            label="Что хранят позиции"
            hint="Коэффициенты умножают цену — например надбавка за двустороннюю печать."
          >
            <Select
              value={kind}
              options={[
                { value: 'money', label: 'Цены в рублях' },
                { value: 'factor', label: 'Коэффициенты (×1.8)' },
              ]}
              onChange={(v) => setKind(v as PriceGroupKind)}
            />
          </Field>
        </div>
      </Section>
    </ModalShell>
  );
}
