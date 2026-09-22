/* Перенос позиции прайса в другой раздел.

   Раньше объединить разделы можно было только руками: завести позицию
   заново, переключить на неё поле вида работ и удалить старую. Средний шаг
   легко забыть, а платой была тихо пропавшая строка в расчёте. Здесь всё
   происходит одним действием, и последствия названы заранее. */

import { useState } from 'react';

import { movePriceItem, usePricesInvalidation } from '@/api/prices';
import { ModalShell, useModalFrame } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Field, Section } from '@/components/ui';
import { Select } from '@/components/Select';
import { formatRate } from '@/lib/format';
import type { PriceGroup, PriceItem } from '@/types/api';

interface MoveItemModalProps {
  item: PriceItem;
  /** раздел, в котором позиция лежит сейчас */
  source: PriceGroup;
  /** куда можно переносить — все разделы справочника */
  groups: PriceGroup[];
}

export function MoveItemModal({ item, source, groups }: MoveItemModalProps) {
  const frame = useModalFrame();
  const { toast, toastError } = useToast();
  const invalidate = usePricesInvalidation();

  const targets = groups.filter((g) => g.id !== null && g.key !== source.key);
  const [target, setTarget] = useState(targets[0]?.key ?? '');
  const [saving, setSaving] = useState(false);

  /* Виды работ, которые ссылаются на позицию поимённо, переедут вместе с
   * ней. Остальные, кто брал раздел списком, потеряют один вариант — про
   * это честнее предупредить заранее, чем разбираться потом. */
  const follows = item.used_by;
  const losesOption = source.used_by.filter((name) => !follows.includes(name));

  const targetGroup = targets.find((g) => g.key === target);
  const clash = targetGroup?.items.some((i) => i.item_key === item.item_key) ?? false;

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await movePriceItem(item.id, target);
      toast(`«${item.item_key}» перенесена в «${targetGroup?.title ?? ''}»`);
      invalidate();
      frame.close();
    } catch (e) {
      toastError(e);
      setSaving(false);
    }
  };

  return (
    <ModalShell
      eyebrow="Прайс"
      title="Перенести позицию"
      foot={
        <>
          <button className="btn btn-ghost" type="button" onClick={frame.close}>
            Отмена
          </button>
          <div className="spacer" />
          <button
            className="btn btn-green"
            type="button"
            disabled={saving || !target || clash}
            onClick={submit}
          >
            Перенести
          </button>
        </>
      }
    >
      <Section title="Что переносим">
        <p className="confirm-text">
          <b>{item.item_key}</b> — {formatRate(item.value, item.unit)}, сейчас в разделе «
          {source.title}».
        </p>
      </Section>

      <Section title="Куда">
        {targets.length === 0 ? (
          <div className="mx-empty">Других разделов пока нет — сначала создайте раздел.</div>
        ) : (
          <Field
            label="Раздел"
            error={
              clash
                ? `В «${targetGroup?.title}» уже есть позиция с ключом «${item.item_key}» — переименуйте одну из них.`
                : null
            }
          >
            <Select
              value={target}
              options={targets.map((group) => ({ value: group.key, label: group.title }))}
              onChange={setTarget}
            />
          </Field>
        )}
      </Section>

      {(follows.length > 0 || losesOption.length > 0) && (
        <Section title="Что изменится">
          {follows.length > 0 && (
            <p className="confirm-text">
              Переедут следом, ничего настраивать не нужно: <b>{follows.join(', ')}</b>. Эти виды
              работ ссылаются на позицию по имени, и ссылка переключится сама.
            </p>
          )}
          {losesOption.length > 0 && (
            <div className="confirm-note">
              Из списков этих видов работ вариант исчезнет: {losesOption.join(', ')}. Они берут
              варианты из раздела целиком — проверьте их после переноса.
            </div>
          )}
        </Section>
      )}
    </ModalShell>
  );
}
