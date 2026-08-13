/* Раздел «Прайс».

   Навигация как по папкам: главная страница показывает только разделы
   верхнего уровня, подразделы открываются внутри своего родителя. Раньше
   подразделы были разложены прямо на главной, а страница родителя при этом
   пустовала — искать их шли именно туда, где их не было. */

import { useState } from 'react';

import { restoreDefaults, usePrices, usePricesInvalidation } from '@/api/prices';
import { useCan } from '@/app/AuthProvider';
import { useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Empty, Loading, PageHead } from '@/components/ui';

import { GroupTile } from './GroupTile';
import { PriceGroupEditor } from './PriceGroupEditor';
import { PriceGroupView } from './PriceGroupView';
import { buildTree } from './tree';

export function PricesPage() {
  const can = useCan();
  const modal = useModal();
  const { toast, toastError } = useToast();
  const prices = usePrices();
  const invalidate = usePricesInvalidation();

  const [openKey, setOpenKey] = useState<string | null>(null);

  const groups = prices.data?.groups ?? [];
  const openGroup = openKey ? groups.find((g) => g.key === openKey) : undefined;

  if (prices.isLoading) {
    return (
      <main className="page scroll-page">
        <div className="page-inner">
          <Loading>Загружаю прайс…</Loading>
        </div>
      </main>
    );
  }

  if (prices.isError) {
    return (
      <main className="page scroll-page">
        <div className="page-inner">
          <Empty>{(prices.error as Error).message}</Empty>
        </div>
      </main>
    );
  }

  // раздел мог исчезнуть, пока страница была открыта — возвращаемся к плиткам
  if (openKey && !openGroup) {
    setOpenKey(null);
    return null;
  }

  const open = (key: string | null) => {
    setOpenKey(key);
    document.querySelector('.scroll-page')?.scrollTo({ top: 0 });
  };

  if (openGroup) {
    return <PriceGroupView group={openGroup} groups={groups} onOpen={open} />;
  }

  const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0);
  const tree = buildTree(groups);

  const restore = async () => {
    try {
      const result = await restoreDefaults();
      toast(result.added ? `Добавлено позиций: ${result.added}` : 'Всё на месте, добавлять нечего');
      if (result.added) invalidate();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Настройки"
          title="Прайс"
          sub={
            <>
              {can('prices.edit')
                ? 'Цены применяются сразу: сотрудник нажмёт «Рассчитать» в заказе и получит новую сумму. Уже созданные заказы не пересчитываются — их стоимость зафиксирована.'
                : 'Прайс открыт для просмотра. Менять цены может администратор.'}{' '}
              Всего разделов: {groups.length}, позиций: {totalItems}.
            </>
          }
          actions={
            can('prices.edit') && (
              <>
                <button
                  className="btn btn-green"
                  type="button"
                  onClick={() => modal.open(<PriceGroupEditor group={null} groups={groups} />)}
                >
                  + Новый раздел
                </button>
                <button className="btn btn-ghost" type="button" onClick={restore}>
                  Восстановить недостающие
                </button>
              </>
            )
          }
        />

        {/* Только верхний уровень. Подразделы живут внутри своего родителя —
            там их и ищут. Все плитки в ОДНОЙ сетке: отдельный контейнер на
            каждую превращал сетку из трёх колонок в столбик. */}
        <div className="pr-tiles">
          {tree.map(({ group, children }) => (
            <GroupTile
              group={group}
              childCount={children.length}
              onOpen={open}
              key={group.key}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
