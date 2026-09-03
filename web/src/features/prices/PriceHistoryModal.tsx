/* История изменений одной позиции прайса.

   «Когда мы подняли баннер до 800 и с чего?» — раньше ответа не было: в
   строке стояло «менял Администратор», без даты и без прежней цены. Теперь
   каждая смена цены или единицы записывается, и здесь их видно. */

import { useQuery } from '@tanstack/react-query';

import { fetchPriceHistory } from '@/api/prices';
import { ModalShell } from '@/app/ModalProvider';
import { Empty, Loading } from '@/components/ui';
import { dtFullRu, formatRate } from '@/lib/format';
import type { PriceItem } from '@/types/api';

export function PriceHistoryModal({ item }: { item: PriceItem }) {
  const history = useQuery({
    queryKey: ['prices', 'history', item.id],
    queryFn: () => fetchPriceHistory(item.id),
  });

  const rows = history.data ?? [];

  return (
    <ModalShell eyebrow={`Прайс · ${item.item_key}`} title={item.title || item.item_key}>
      {history.isLoading && <Loading />}
      {history.isError && <Empty>{(history.error as Error).message}</Empty>}
      {history.isSuccess && rows.length === 0 && (
        <Empty>
          Изменений пока не записано. История ведётся с момента, когда её включили; что
          было раньше — уже не восстановить.
        </Empty>
      )}

      {rows.length > 0 && (
        <ul className="feed">
          {rows.map((change) => (
            <li key={change.id}>
              {change.field === 'unit' ? (
                <>
                  Единица: {change.old_value || '—'} → <b>{change.new_value || '—'}</b>
                </>
              ) : (
                <>
                  {formatRate(Number(change.old_value), item.unit)} →{' '}
                  <b>{formatRate(Number(change.new_value), item.unit)}</b>
                </>
              )}
              {change.author ? ` · ${change.author}` : ''}
              <time>{dtFullRu(change.created_at)}</time>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
