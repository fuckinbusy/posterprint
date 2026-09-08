/* Отчёт по мастерской на бумагу.

   Одна страница-две A4 с теми же цифрами, что на экране, но без цвета и
   графиков: таблицы, которые читаются на распечатке и в папке у владельца.
   Печатается тем же способом, что квитанция и касса: на бумагу уходит
   только тело окна (см. @media print в app.css). */

import { ModalBackButton, ModalShell } from '@/app/ModalProvider';
import { PrintIcon } from '@/components/Icons';
import { money, moneyOrZero, plural } from '@/lib/format';
import { usePageSize } from '@/lib/printPage';
import type { Metrics, PayMethod, ShopDetails } from '@/types/api';

const METHOD_LABEL: Record<PayMethod, string> = { cash: 'Наличные', transfer: 'Перевод' };

function pct(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '0%';
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}%`;
}

function rub(value: number | null | undefined): string {
  return moneyOrZero(value ?? 0);
}

export function MetricsReportModal({
  metrics: m,
  shop,
  periodLabel,
}: {
  metrics: Metrics;
  shop?: ShopDetails;
  periodLabel: string;
}) {
  usePageSize('A4', '12mm');
  const printed = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const prev = m.previous;
  const cash = m.cash;
  const debtTotal = m.debtors.reduce((a, d) => a + d.debt, 0);
  const managersTotal = m.by_manager.reduce((a, r) => a + r.sum, 0);

  return (
    <ModalShell
      wide
      eyebrow="Отчёт"
      title={`Аналитика · ${periodLabel}`}
      foot={
        <>
          <span className="print-hint">На бумаге — чёрно-белые таблицы, A4. Цифры те же, что на экране.</span>
          <div className="spacer" />
          <ModalBackButton />
          <button className="btn btn-green" type="button" onClick={() => window.print()}>
            <PrintIcon />
            Печать
          </button>
        </>
      }
    >
      <div className="print-sheet rp-sheet">
        <header className="rp-head">
          <div>
            <div className="rp-shop">{shop?.name || 'Мастерская'}</div>
            <h1>Сводка по мастерской</h1>
            <div className="rp-period">
              Период: <b>{periodLabel}</b>
              {m.period.kind === 'range' && <span> ({m.period.label})</span>}
              {prev && <span> · рядом — прошлый период той же длины и изменение к нему</span>}
            </div>
          </div>
          <div className="rp-printed">напечатано {printed}</div>
        </header>

        {/* ---- главное */}
        <section className="rp-sec">
          <h2>Итоги периода</h2>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Показатель</th>
                <th className="num">За период</th>
                {prev && <th className="num">Прошлый период</th>}
                {prev && <th className="num">Изменение</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="strong">
                <td>Получено по выданным заказам</td>
                <td className="num">{rub(m.revenue)}</td>
                {prev && <td className="num">{rub(prev.revenue)}</td>}
                {prev && <td className="num">{pct(m.compare.revenue)}</td>}
              </tr>
              <tr>
                <td>Выдано заказов</td>
                <td className="num">{m.orders_done}</td>
                {prev && <td className="num">{prev.orders_done}</td>}
                {prev && <td className="num">{pct(m.compare.orders_done)}</td>}
              </tr>
              <tr>
                <td>Средний чек</td>
                <td className="num">{rub(m.avg_check)}</td>
                {prev && <td className="num">{rub(prev.avg_check)}</td>}
                {prev && <td className="num">{pct(m.compare.avg_check)}</td>}
              </tr>
              <tr>
                <td>Принято заказов</td>
                <td className="num">{m.created_count}</td>
                {prev && <td className="num">{prev.created_count}</td>}
                {prev && <td className="num">{pct(m.compare.created_count)}</td>}
              </tr>
              <tr>
                <td>Отменено</td>
                <td className="num">
                  {m.cancelled_count} ({m.cancel_rate}%)
                </td>
                {prev && <td className="num">{prev.cancelled_count}</td>}
                {prev && <td className="num">{pct(m.compare.cancelled_count)}</td>}
              </tr>
              <tr>
                <td>Новых клиентов</td>
                <td className="num">{m.clients.new}</td>
                {prev && <td className="num">{prev.clients_new}</td>}
                {prev && <td className="num">{pct(m.compare.clients_new)}</td>}
              </tr>
              <tr>
                <td>Повторных клиентов · доля их денег в выручке</td>
                <td className="num">
                  {m.clients.returning} · {m.clients.returning_share !== null ? `${m.clients.returning_share}%` : '—'}
                </td>
                {prev && <td className="num" colSpan={2} />}
              </tr>
              <tr>
                <td>Средний срок от приёма до выдачи</td>
                <td className="num">{m.avg_lead_days !== null ? `${m.avg_lead_days} дн.` : '—'}</td>
                {prev && <td className="num" colSpan={2} />}
              </tr>
              <tr>
                <td>Выдано в срок (из заказов со сроком)</td>
                <td className="num">
                  {m.on_time.rate !== null ? `${m.on_time.rate}% · ${m.on_time.count} из ${m.on_time.total}` : '—'}
                </td>
                {prev && <td className="num" colSpan={2} />}
              </tr>
              <tr>
                <td>Доп. услуги в выданных заказах</td>
                <td className="num">
                  {rub(m.extras_sum)} · {m.extras_share}%
                </td>
                {prev && <td className="num" colSpan={2} />}
              </tr>
              <tr>
                <td>Не доплатили по выданным за период · всего висит</td>
                <td className="num">
                  {rub(m.done_debt)} · {rub(m.done_debt_all)}
                </td>
                {prev && <td className="num" colSpan={2} />}
              </tr>
            </tbody>
          </table>
        </section>

        {/* ---- касса */}
        <section className="rp-sec">
          <h2>Касса за период — по датам платежей</h2>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Способ</th>
                <th className="num">Приняли</th>
                <th className="num">Вернули</th>
                <th className="num">Итого</th>
              </tr>
            </thead>
            <tbody>
              {(['cash', 'transfer'] as PayMethod[]).map((method) => (
                <tr key={method}>
                  <td>{METHOD_LABEL[method]}</td>
                  <td className="num">{rub(cash.by_method[method].in)}</td>
                  <td className="num">{rub(cash.by_method[method].out)}</td>
                  <td className="num">{rub(cash.by_method[method].net)}</td>
                </tr>
              ))}
              <tr className="strong">
                <td>Всего</td>
                <td className="num">{rub(cash.total_in)}</td>
                <td className="num">{rub(cash.total_out)}</td>
                <td className="num">{rub(cash.total)}</td>
              </tr>
            </tbody>
          </table>
          {cash.by_author.length > 1 && (
            <table className="rp-table compact">
              <thead>
                <tr>
                  <th>Принимал деньги</th>
                  <th className="num">Наличные</th>
                  <th className="num">Перевод</th>
                  <th className="num">Итого</th>
                </tr>
              </thead>
              <tbody>
                {cash.by_author.map((row) => (
                  <tr key={row.author}>
                    <td>{row.author}</td>
                    <td className="num">{rub(row.cash)}</td>
                    <td className="num">{rub(row.transfer)}</td>
                    <td className="num">{rub(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ---- в работе */}
        <section className="rp-sec">
          <h2>Сейчас в работе</h2>
          <table className="rp-table">
            <tbody>
              <tr>
                <td>Заказов в работе</td>
                <td className="num">
                  {m.active_count} на {rub(m.active_sum)}
                </td>
              </tr>
              <tr>
                <td>Ждём доплаты · предоплат в кассе</td>
                <td className="num">
                  {rub(m.debt)} · {rub(m.prepaid_held)}
                </td>
              </tr>
              <tr>
                <td>Просрочено · сдать сегодня · без цены</td>
                <td className="num">
                  {m.overdue_count} · {m.due_today_count} · {m.no_price_count}
                </td>
              </tr>
              <tr>
                <td>Без движения {m.stale_days}+ дней</td>
                <td className="num">{m.stale.length}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ---- виды работ */}
        <section className="rp-sec">
          <h2>По видам работ</h2>
          {m.by_template.length === 0 ? (
            <p className="rp-empty">За период нет выданных заказов.</p>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Вид работ</th>
                  <th className="num">Заказов</th>
                  <th className="num">Получено</th>
                  <th className="num">Доля</th>
                  <th className="num">Средний чек</th>
                  <th className="num">Срок, дн.</th>
                </tr>
              </thead>
              <tbody>
                {m.by_template.map((t) => (
                  <tr key={t.key}>
                    <td>{t.title}</td>
                    <td className="num">{t.count}</td>
                    <td className="num">{rub(t.sum)}</td>
                    <td className="num">{t.share}%</td>
                    <td className="num">{rub(t.count ? t.sum / t.count : 0)}</td>
                    <td className="num">{t.avg_lead_days ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ---- клиенты */}
        <section className="rp-sec">
          <h2>Клиенты по выручке — первые {Math.min(m.top_clients.length, 15)}</h2>
          {m.top_clients.length === 0 ? (
            <p className="rp-empty">За период нет выданных заказов.</p>
          ) : (
            <table className="rp-table compact">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Клиент</th>
                  <th className="num">Заказов</th>
                  <th className="num">Получено</th>
                  <th className="num">Доля</th>
                </tr>
              </thead>
              <tbody>
                {m.top_clients.slice(0, 15).map((c, i) => (
                  <tr key={`${c.client_id ?? 'none'}-${i}`}>
                    <td>{i + 1}</td>
                    <td>{c.name}</td>
                    <td className="num">{c.count}</td>
                    <td className="num">{rub(c.sum)}</td>
                    <td className="num">{m.revenue ? Math.round((c.sum / m.revenue) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ---- сотрудники */}
        {m.by_manager.length > 0 && (
          <section className="rp-sec">
            <h2>По сотрудникам</h2>
            <table className="rp-table compact">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th className="num">Принял</th>
                  <th className="num">Выдал</th>
                  <th className="num">Получено</th>
                  <th className="num">Доля</th>
                </tr>
              </thead>
              <tbody>
                {m.by_manager.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className="num">{r.created}</td>
                    <td className="num">{r.done}</td>
                    <td className="num">{rub(r.sum)}</td>
                    <td className="num">{managersTotal ? Math.round((r.sum / managersTotal) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="rp-note">
              «Принял» — заказы, оформленные за период; «получено» — деньги по заказам, принятым сотрудником и
              выданным за период.
            </p>
          </section>
        )}

        {/* ---- должники */}
        <section className="rp-sec">
          <h2>Должники{debtTotal ? ` — ${money(debtTotal)}` : ''}</h2>
          {m.debtors.length === 0 ? (
            <p className="rp-empty">Долгов нет: все выданные заказы оплачены.</p>
          ) : (
            <table className="rp-table compact">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Клиент</th>
                  <th>Что</th>
                  <th>Состояние</th>
                  <th className="num">Цена</th>
                  <th className="num">Долг</th>
                </tr>
              </thead>
              <tbody>
                {m.debtors.map((d) => (
                  <tr key={d.order_id}>
                    <td className="nowrap">{d.number}</td>
                    <td>{d.client}</td>
                    <td>{d.title}</td>
                    <td className="nowrap">
                      {d.kind === 'done' ? 'выдан' : 'просрочен'} · {d.days} {plural(d.days, 'день', 'дня', 'дней')}
                    </td>
                    <td className="num">{rub(d.price)}</td>
                    <td className="num">{rub(d.debt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ---- зависшие */}
        {m.stale.length > 0 && (
          <section className="rp-sec">
            <h2>Без движения {m.stale_days}+ дней</h2>
            <table className="rp-table compact">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Что</th>
                  <th>Клиент</th>
                  <th className="num">Дней</th>
                  <th className="num">Цена</th>
                </tr>
              </thead>
              <tbody>
                {m.stale.map((r) => (
                  <tr key={r.order_id}>
                    <td className="nowrap">{r.number}</td>
                    <td>{r.title}</td>
                    <td>{r.client || '—'}</td>
                    <td className="num">{r.days}</td>
                    <td className="num">{rub(r.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ---- заявки и нагрузка */}
        <section className="rp-sec rp-two">
          <div>
            <h2>Почему отменяли</h2>
            {m.cancel_reasons.length === 0 ? (
              <p className="rp-empty">Отмен за период не было.</p>
            ) : (
              <table className="rp-table compact">
                <tbody>
                  {m.cancel_reasons.map((r) => (
                    <tr key={r.reason}>
                      <td>{r.reason}</td>
                      <td className="num">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h2>Заказы по дням недели</h2>
            <table className="rp-table compact">
              <tbody>
                {m.weekday_load.map((d) => (
                  <tr key={d.label}>
                    <td>{d.label}</td>
                    <td className="num">{d.count}</td>
                    <td className="num">{rub(d.sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="rp-foot">
          Выручка — по заказам, выданным за период, по фактически внесённому. Касса — по датам платежей, поэтому
          может отличаться: предоплата за заказ, выданный в этом периоде, могла быть внесена в прошлом.
        </footer>
      </div>
    </ModalShell>
  );
}
