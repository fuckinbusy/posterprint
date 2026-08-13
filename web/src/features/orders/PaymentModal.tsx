/* «Куда платить»: QR и реквизиты — экраном к клиенту.

   Сценарий ровно один: человек стоит у стойки и спрашивает, куда переводить.
   Сотрудник открывает это окно и разворачивает монитор. Значит всё крупное:
   QR такого размера, чтобы телефон навёлся с полуметра, сумма — чтобы её
   прочитали, не наклоняясь.

   QR — платёжная строка по ГОСТ Р 56042 (собирает app/payments.py): банковское
   приложение подставит и реквизиты, и сумму. Продиктованный вслух счёт из
   двадцати цифр клиент рано или поздно наберёт с ошибкой — здесь ошибаться
   негде.

   Сумма по умолчанию — остаток к доплате. Но предоплату берут не всегда
   ровно половиной, поэтому её можно переключить или ввести свою: пересчёт
   идёт на сервере, каждая сумма — свой код. */

import { useState } from 'react';

import { useOrderPayment } from '@/api/orders';
import { useCan } from '@/app/AuthProvider';
import { ModalBackButton, ModalShell } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Empty, Loading } from '@/components/ui';
import { copyText } from '@/lib/clipboard';
import { money, moneyOrZero } from '@/lib/format';
import type { Order } from '@/types/api';

type AmountKind = 'debt' | 'full' | 'custom';

export function PaymentModal({ order }: { order: Order }) {
  const can = useCan();
  const { toast } = useToast();

  // остаток может быть нулём (заказ оплачен) — тогда начинаем с полной суммы:
  // показывать клиенту код на ноль рублей бессмысленно
  const [kind, setKind] = useState<AmountKind>(order.debt > 0 ? 'debt' : 'full');
  const [custom, setCustom] = useState('');

  const amount =
    kind === 'debt' ? order.debt : kind === 'full' ? order.price : Number(custom || 0);

  const payment = useOrderPayment(order.id, Math.max(amount, 0), can('orders.price.view'));

  const copy = async (value: string) => {
    toast((await copyText(value)) ? 'Скопировано' : 'Скопировать не вышло — выделите вручную');
  };

  return (
    <ModalShell
      eyebrow={`Оплата · ${order.number}`}
      title="Куда платить"
      foot={
        <>
          <div className="spacer" />
          <ModalBackButton />
        </>
      }
    >
      <div className="pay-amount">
        <div className="pay-kinds">
          <button
            className={kind === 'debt' ? 'active' : ''}
            type="button"
            disabled={order.debt <= 0}
            onClick={() => setKind('debt')}
          >
            Остаток {order.debt > 0 ? money(order.debt) : '—'}
          </button>
          <button
            className={kind === 'full' ? 'active' : ''}
            type="button"
            onClick={() => setKind('full')}
          >
            Вся сумма {money(order.price) || '—'}
          </button>
          <button
            className={kind === 'custom' ? 'active' : ''}
            type="button"
            onClick={() => setKind('custom')}
          >
            Своя
          </button>
        </div>
        {kind === 'custom' && (
          <input
            type="number"
            min={0}
            step={10}
            autoFocus
            placeholder="Сколько платит сейчас"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}
      </div>

      {payment.isLoading && <Loading />}
      {payment.isError && <Empty>{(payment.error as Error).message}</Empty>}

      {payment.data && !payment.data.available && (
        <Empty>
          Реквизиты для оплаты не заполнены.
          {payment.data.problems.length > 0 && (
            <ul className="pay-problems">
              {payment.data.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <span className="pay-where">Заполняются в файле .env рядом с программой.</span>
        </Empty>
      )}

      {payment.data?.available && (
        <div className="pay-show">
          <div className="pay-sum">
            <span>К оплате</span>
            <b>{amount > 0 ? moneyOrZero(amount) : 'сумму введёт клиент'}</b>
          </div>

          {payment.data.qr ? (
            <div className="pay-qr">
              <img src={payment.data.qr} alt="QR-код для оплаты" />
              <span>Наведите камеру телефона — реквизиты и сумма подставятся сами</span>
            </div>
          ) : (
            <div className="pay-noqr">
              QR не показываем: банковские реквизиты заполнены не полностью.
              {/* карта и телефон ниже работают и без него */}
            </div>
          )}

          {payment.data.recipient && (
            <div className="pay-line">
              <span>Получатель</span>
              <b>{payment.data.recipient}</b>
            </div>
          )}

          {payment.data.requisites.map((item) => (
            <div className="pay-line" key={item.label}>
              <span>{item.label}</span>
              <b>{item.value}</b>
              <button type="button" onClick={() => void copy(item.value)}>
                копировать
              </button>
            </div>
          ))}

          {payment.data.note && <p className="pay-note">{payment.data.note}</p>}

          <p className="pay-purpose">
            Назначение платежа: {payment.data.purpose}
          </p>
        </div>
      )}
    </ModalShell>
  );
}
