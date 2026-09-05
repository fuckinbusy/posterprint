/* Касса за день — для того, кто вечером закрывает смену.

   Сколько денег принято за день, кем и как — наличными или переводом, и
   что вернули. Наличные пересчитывают в ящике, переводы сверяют с выпиской,
   поэтому два способа показаны раздельно, а приход и расход — отдельными
   числами: «приняли 12 000, вернули 2 000» кассиру говорит больше, чем
   «итого 10 000».

   Строки — из журнала движений денег (app/ledger.py): каждая правка
   внесённого по заказу оставляет запись. Заказы, оформленные до появления
   журнала, здесь не видны — по ним есть только итог в карточке. */

import { useState } from 'react';

import { useCashReport } from '@/api/reports';
import { ModalShell } from '@/app/ModalProvider';
import { ArrowLeftIcon, ArrowIcon } from '@/components/Icons';
import { Empty, Loading } from '@/components/ui';
import { useOpenOrder } from '@/features/orders/useOpenOrder';
import { dateFullRu, money, moneyOrZero, todayISO } from '@/lib/format';
import type { CashEntry, PayMethod } from '@/types/api';

const METHOD_LABEL: Record<PayMethod, string> = { cash: 'Наличные', transfer: 'Перевод' };

function shiftDay(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const next = new Date(y, m - 1, d + days);
  const local = new Date(next.getTime() - next.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function timeRu(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function CashModal() {
  const [date, setDate] = useState(todayISO());
  const report = useCashReport(date);
  const openOrder = useOpenOrder();
  const isToday = date === todayISO();

  const data = report.data;

  return (
    <ModalShell
      eyebrow="Касса"
      title={isToday ? 'Сегодня' : dateFullRu(date)}
      foot={
        <>
          <div className="cash-nav">
            <button className="icon-btn" type="button" aria-label="Предыдущий день" onClick={() => setDate(shiftDay(date, -1))}>
              <ArrowLeftIcon />
            </button>
            <input
              type="date"
              value={date}
              max={todayISO()}
              aria-label="День"
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
            <button
              className="icon-btn"
              type="button"
              aria-label="Следующий день"
              disabled={isToday}
              onClick={() => setDate(shiftDay(date, 1))}
            >
              <ArrowIcon />
            </button>
            {!isToday && (
              <button className="btn btn-ghost" type="button" onClick={() => setDate(todayISO())}>
                Сегодня
              </button>
            )}
          </div>
          <div className="spacer" />
        </>
      }
    >
      {!data && report.isLoading && <Loading />}
      {data && (
        <>
          {/* итог — крупно, как в квитанции: с этим числом идут к ящику */}
          <div className="cash-totals">
            {(['cash', 'transfer'] as PayMethod[]).map((method) => {
              const sums = data.by_method[method];
              return (
                <div className="cash-total" key={method}>
                  <span>{METHOD_LABEL[method]}</span>
                  <b>{moneyOrZero(sums.net)}</b>
                  {sums.out > 0 && (
                    <em>
                      приняли {money(sums.in)} · вернули {money(sums.out)}
                    </em>
                  )}
                </div>
              );
            })}
            <div className="cash-total big">
              <span>Итого за день</span>
              <b>{moneyOrZero(data.total)}</b>
              {data.total_out > 0 && (
                <em>
                  приняли {money(data.total_in)} · вернули {money(data.total_out)}
                </em>
              )}
            </div>
          </div>

          {data.by_author.length > 1 && (
            <table className="cash-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th className="num">Наличные</th>
                  <th className="num">Перевод</th>
                  <th className="num">Итого</th>
                </tr>
              </thead>
              <tbody>
                {data.by_author.map((row) => (
                  <tr key={row.author}>
                    <td>{row.author}</td>
                    <td className="num">{moneyOrZero(row.cash)}</td>
                    <td className="num">{moneyOrZero(row.transfer)}</td>
                    <td className="num">
                      <b>{moneyOrZero(row.total)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {data.entries.length === 0 ? (
            <Empty>{isToday ? 'Сегодня денег ещё не принимали.' : 'В этот день движений денег не было.'}</Empty>
          ) : (
            <div className="cash-list" role="list">
              {data.entries.map((entry) => (
                <CashRow key={entry.id} entry={entry} onOpen={() => openOrder(entry.order_id, { push: true, backLabel: '← К кассе' })} />
              ))}
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}

function CashRow({ entry, onOpen }: { entry: CashEntry; onOpen: () => void }) {
  const refund = entry.amount < 0;
  return (
    <button className={refund ? 'cash-row out' : 'cash-row'} type="button" role="listitem" onClick={onOpen}>
      <span className="cash-time">{timeRu(entry.at)}</span>
      <span className="cash-order">
        <b>{entry.order_number}</b>
        <span>{[entry.client_name, entry.title].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="cash-method">
        {METHOD_LABEL[entry.method] ?? entry.method}
        {entry.author && <em>{entry.author}</em>}
      </span>
      <span className="cash-amount">
        {refund ? '− ' : '+ '}
        {money(Math.abs(entry.amount))}
      </span>
    </button>
  );
}
