/* Слияние двух карточек клиента.

   Дубли заводятся сами: клиент назвал второй номер, приёмщик опечатался,
   номер записали без кода. Телефон уникален, но у человека номеров может
   быть два — и каждый заказ уходит в свою карточку. История разъезжается,
   и чем дольше, тем хуже.

   Здесь выбирают, В КАКУЮ карточку влить текущую: её заказы переезжают туда,
   пустые поля там дополняются отсюда, а эта карточка удаляется. Обратной
   операции нет — поэтому вопрос перед действием подробный. */

import { useState } from 'react';

import { useClientSearch, useMergeClient } from '@/api/clients';
import { useConfirm } from '@/app/ConfirmProvider';
import { ModalBackButton, ModalShell, useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Empty } from '@/components/ui';
import { initials, plural } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import type { Client } from '@/types/api';

import { ClientCardModal } from './ClientCardModal';

export function MergeClientModal({ client }: { client: Client }) {
  const modal = useModal();
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();
  const merge = useMergeClient();

  const [query, setQuery] = useState('');
  const search = useClientSearch(query, true);
  // саму себя из вариантов убираем: слить карточку в неё же нельзя
  const candidates = (search.data ?? []).filter((c) => c.id !== client.id);

  const pick = async (target: Client) => {
    const ok = await askConfirm({
      eyebrow: 'Слияние карточек',
      title: `Влить в «${target.name || 'Без имени'}»?`,
      text: [
        <>
          Карточка <b>{client.name || 'Без имени'}</b> исчезнет. Её{' '}
          {client.orders_count} {plural(client.orders_count, 'заказ', 'заказа', 'заказов')}{' '}
          перейдут к <b>{target.name || 'Без имени'}</b>.
        </>,
        'Телефон, почта и заметка второй карточки дополнятся из первой, если там пусто.',
      ],
      note: 'Отменить слияние нельзя.',
      yes: 'Объединить',
      danger: true,
    });
    if (!ok) return;
    try {
      const merged = await merge.mutateAsync({ id: client.id, into: target.id });
      toast(`Карточки объединены: «${merged.name || 'Без имени'}»`);
      modal.open(<ClientCardModal clientId={merged.id} />);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <ModalShell
      eyebrow={`Клиент · ${client.name || 'Без имени'}`}
      title="Объединить с другой карточкой"
      foot={
        <>
          <div className="spacer" />
          <ModalBackButton />
        </>
      }
    >
      <p className="sub" style={{ marginBottom: 14 }}>
        Найдите карточку того же человека. Эта карточка исчезнет, её заказы
        перейдут к выбранной — история снова будет в одном месте.
      </p>
      <div className="field">
        <input
          type="search"
          autoFocus
          placeholder="Имя, телефон, почта…"
          aria-label="Поиск карточки для слияния"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {query.trim().length < 2 && <Empty>Введите хотя бы две буквы или цифры</Empty>}
      {query.trim().length >= 2 && search.isSuccess && candidates.length === 0 && (
        <Empty>Никого не нашлось</Empty>
      )}

      {candidates.length > 0 && (
        <div className="cl-list" style={{ marginTop: 12 }}>
          {candidates.map((c) => (
            <button className="cl-row" type="button" key={c.id} onClick={() => void pick(c)}>
              <span className="cl-av">{initials(c.name)}</span>
              <span className="cl-main">
                <b>{c.name || 'Без имени'}</b>
                <span className="meta">
                  {[formatPhone(c.phone), c.contact].filter(Boolean).join(' · ') || 'контактов нет'}
                </span>
              </span>
              <span className="cl-nums">
                <span className="n">{c.orders_count}</span>
                <span className="l">{plural(c.orders_count, 'заказ', 'заказа', 'заказов')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
