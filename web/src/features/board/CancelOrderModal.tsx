/* Отмена заказа: почему.

   Отмена — единственный переход, который что-то говорит о клиенте, а не о
   производстве. Через месяц по доле отмен видно, что дело плохо, но не
   видно почему: передумал клиент, не сошлись в цене или мы сами не успели.
   Поэтому спрашиваем причину — готовыми кнопками, чтобы это занимало одно
   нажатие и формулировки потом сходились между собой. */

import { useState } from 'react';

import { ModalShell, useModalFrame } from '@/app/ModalProvider';
import { Field } from '@/components/ui';
import type { Order } from '@/types/api';

/** Частые причины. Своя формулировка всегда доступна в поле ниже. */
const PRESETS = [
  'Клиент передумал',
  'Не согласовали цену',
  'Клиент не выходит на связь',
  'Ошибка при оформлении',
  'Не успеваем к сроку',
  'Дубль заказа',
];

interface CancelOrderModalProps {
  order: Order;
  onConfirm: (reason: string) => void;
}

export function CancelOrderModal({ order, onConfirm }: CancelOrderModalProps) {
  const frame = useModalFrame();
  const [reason, setReason] = useState('');

  const submit = () => {
    frame.close();
    onConfirm(reason.trim());
  };

  return (
    <ModalShell
      eyebrow={order.number}
      title="Отменить заказ?"
      foot={
        <>
          <button className="btn btn-ghost" type="button" onClick={frame.close}>
            Не отменять
          </button>
          <div className="spacer" />
          <button className="btn btn-danger" type="button" onClick={submit}>
            Отменить заказ
          </button>
        </>
      }
    >
      <p className="confirm-text" style={{ marginBottom: 16 }}>
        Заказ <b>{order.number}</b> — {order.title} перейдёт в «Отменён». Он останется в базе, его
        можно будет вернуть в работу.
      </p>

      <div className="cancel-presets">
        {PRESETS.map((preset) => (
          <button
            className={reason === preset ? 'active' : ''}
            type="button"
            key={preset}
            onClick={() => setReason(reason === preset ? '' : preset)}
          >
            {preset}
          </button>
        ))}
      </div>

      <Field
        label="Причина"
        hint="Необязательно, но через месяц по одним цифрам уже не вспомнить, что случилось."
      >
        <textarea
          value={reason}
          placeholder="Своими словами"
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </ModalShell>
  );
}
