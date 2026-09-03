/* Раздел «Клиенты»: весь справочник с поиском и сортировками. */

import { useEffect, useState } from 'react';

import { CLIENTS_PAGE, useClients, useClientsSummary } from '@/api/clients';
import { downloadCsv } from '@/api/export';
import { useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { SearchIcon } from '@/components/Icons';
import { Pager } from '@/components/Pager';
import { Empty, Loading, PageHead } from '@/components/ui';
import { dateRu, initials, money, moneyOrZero, plural } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import type { ClientSort } from '@/types/api';

import { ClientCardModal } from './ClientCardModal';

const SORTS: { key: ClientSort; title: string }[] = [
  { key: 'recent', title: 'Последние' },
  { key: 'orders', title: 'По числу заказов' },
  { key: 'sum', title: 'По сумме' },
  { key: 'name', title: 'По имени' },
];

const DEBOUNCE_MS = 300;

export function ClientsPage() {
  const modal = useModal();
  const { toast } = useToast();

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ClientSort>('recent');
  const [offset, setOffset] = useState(0);

  // запрос отстаёт от ввода: иначе на каждую букву уходит обращение к базе
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(input.trim());
      setOffset(0); // новый поиск — с первой страницы
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  const page = useClients({ q: query, sort, offset });
  const summary = useClientsSummary();

  const items = page.data?.items ?? [];

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Справочник"
          title="Клиенты"
          sub="Карточки заводятся сами при создании заказа. Здесь — весь список с поиском и историей: видно, кто сколько заказывал и когда обращался последний раз."
          actions={
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() =>
                void downloadCsv('/export/clients.csv', 'клиенты.csv').then((ok) =>
                  toast(ok ? 'Файл сохраняется' : 'Не удалось выгрузить — проверьте права'),
                )
              }
            >
              Выгрузить CSV
            </button>
          }
        />

        <div className="cl-tools">
          <div className="cl-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Имя, телефон, почта…"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          {/* при поиске порядок задаёт совпадение, а не выбранная сортировка */}
          {!query && (
            <div className="cl-sorts">
              {SORTS.map((item) => (
                <button
                  className={sort === item.key ? 'active' : ''}
                  type="button"
                  key={item.key}
                  onClick={() => {
                    setSort(item.key);
                    setOffset(0);
                  }}
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {summary.data && (
          <div className="cl-summary">
            <span>
              <b>{summary.data.total}</b>{' '}
              {plural(summary.data.total, 'клиент', 'клиента', 'клиентов')}
            </span>
            <span>
              <b>{summary.data.with_orders}</b> с заказами
            </span>
            {summary.data.revenue !== undefined && (
              <span>
                на <b>{moneyOrZero(summary.data.revenue)}</b>
              </span>
            )}
          </div>
        )}

        {page.isLoading && <Loading />}
        {page.isError && <Empty>{(page.error as Error).message}</Empty>}

        {page.data && items.length === 0 && (
          <Empty>{query ? 'Никого не нашлось' : 'Клиентов пока нет'}</Empty>
        )}

        {items.length > 0 && (
          <div className="cl-list">
            {items.map((client) => (
              <button
                className="cl-row"
                type="button"
                key={client.id}
                onClick={() => modal.open(<ClientCardModal clientId={client.id} />)}
              >
                <span className="cl-av">{initials(client.name)}</span>
                <span className="cl-main">
                  <b>{client.name || 'Без имени'}</b>
                  <span className="meta">
                    {[formatPhone(client.phone), client.contact].filter(Boolean).join(' · ') ||
                      'контактов нет'}
                  </span>
                </span>
                <span className="cl-nums">
                  <span className="n">{client.orders_count}</span>
                  <span className="l">
                    {plural(client.orders_count, 'заказ', 'заказа', 'заказов')}
                  </span>
                </span>
                {client.active_count > 0 && (
                  <span className="cl-badge">{client.active_count} в работе</span>
                )}
                {client.total_sum !== null && (
                  <span className="cl-sum">{money(client.total_sum) || '—'}</span>
                )}
                <span className="cl-when">
                  {client.last_order_at ? dateRu(String(client.last_order_at).slice(0, 10)) : '—'}
                </span>
              </button>
            ))}
          </div>
        )}

        {page.data && (
          <Pager
            total={page.data.total}
            limit={CLIENTS_PAGE}
            offset={page.data.offset}
            onGo={(next) => {
              setOffset(next);
              document.querySelector('.scroll-page')?.scrollTo({ top: 0 });
            }}
          />
        )}
      </div>
    </main>
  );
}
