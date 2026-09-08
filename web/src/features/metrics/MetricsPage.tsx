/* Раздел «Метрики».

   Выручка считается по моменту перехода заказа в «Выдан»: у заказа для
   этого есть отметка completed_at. Если вернуть заказ из «Выдан» назад,
   отметка снимается — и из выручки он уходит. Касса за период — отдельно,
   по датам платежей: предоплата, внесённая в прошлом месяце, остаётся в
   кассе прошлого месяца.

   Каждая цифра сравнивается с прошлым периодом той же длины: «120 000»
   само по себе ничего не говорит, «120 000, на 18% больше» — говорит. */

import { useState } from 'react';

import { useCatalog } from '@/api/catalog';
import { downloadCsv } from '@/api/export';
import { monthLabel, shiftMonth, thisMonth, useMetrics, type MetricsPeriod } from '@/api/metrics';
import { useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { ArrowIcon, ArrowLeftIcon, PrintIcon } from '@/components/Icons';
import { Empty, Loading, PageHead, Section } from '@/components/ui';
import { useOpenOrder } from '@/features/orders/useOpenOrder';
import { money, moneyOrZero, plural } from '@/lib/format';
import type { Metrics, MetricsDebtor, MetricsStaleOrder, PayMethod } from '@/types/api';

import { MetricsReportModal } from './MetricsReportModal';

const PERIODS = [
  { days: 7, label: 'Неделя' },
  { days: 30, label: '30 дней' },
  { days: 90, label: 'Квартал' },
  { days: 365, label: 'Год' },
  { days: 0, label: 'Всё время' },
];

const METHOD_LABEL: Record<PayMethod, string> = { cash: 'Наличные', transfer: 'Перевод' };

/** Какой разрез открыт вместо общей сводки. */
type Detail = 'templates' | 'clients' | 'managers' | 'debtors' | 'stale' | null;

/** Изменение к прошлому периоду. invert — рост это плохо (отмены). */
export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="mx-delta none">—</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  const cls = value === 0 ? 'mx-delta flat' : good ? 'mx-delta good' : 'mx-delta bad';
  return (
    <span className={cls} title="к прошлому периоду той же длины">
      {value > 0 ? '▲' : value < 0 ? '▼' : '='} {Math.abs(value)}%
    </span>
  );
}

export function MetricsPage() {
  const [period, setPeriod] = useState<MetricsPeriod>({ days: 30 });
  const [detail, setDetail] = useState<Detail>(null);
  const metrics = useMetrics(period);
  const catalog = useCatalog();
  const modal = useModal();
  const { toast } = useToast();

  const month = 'month' in period ? period.month : null;
  const canForward = month !== null && month < thisMonth();

  const exportCsv = async () => {
    const days = 'days' in period ? period.days : 0;
    const ok = await downloadCsv(`/export/orders.csv?days=${days}`, `заказы-${days || 'все'}.csv`);
    toast(ok ? 'Файл сохраняется' : 'Не удалось выгрузить — проверьте права');
  };

  const tabs = (
    <div className="mx-tabs">
      {PERIODS.map((p) => (
        <button
          className={'days' in period && p.days === period.days ? 'active' : ''}
          type="button"
          key={p.days}
          onClick={() => setPeriod({ days: p.days })}
        >
          {p.label}
        </button>
      ))}
      {/* календарный месяц — для отчёта владельцу и бухгалтерии */}
      <div className={month ? 'mx-month active' : 'mx-month'} role="group" aria-label="Месяц">
        <button
          className="icon-btn"
          type="button"
          aria-label="Предыдущий месяц"
          onClick={() => setPeriod({ month: shiftMonth(month ?? thisMonth(), month ? -1 : 0) })}
        >
          <ArrowLeftIcon />
        </button>
        <button type="button" className="mx-month-name" onClick={() => setPeriod({ month: month ?? thisMonth() })}>
          {month ? monthLabel(month) : 'Месяц'}
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label="Следующий месяц"
          disabled={!canForward}
          onClick={() => month && setPeriod({ month: shiftMonth(month, 1) })}
        >
          <ArrowIcon />
        </button>
      </div>
    </div>
  );

  if (metrics.isLoading && !metrics.data) {
    return (
      <main className="page scroll-page">
        <div className="page-inner">
          <Loading>Считаю…</Loading>
        </div>
      </main>
    );
  }

  if (metrics.isError || !metrics.data) {
    return (
      <main className="page scroll-page">
        <div className="page-inner">
          <Empty>{(metrics.error as Error)?.message ?? 'Не удалось посчитать метрики'}</Empty>
        </div>
      </main>
    );
  }

  const m = metrics.data;
  // для месяца сервер отдаёт даты, а человеку понятнее «Август 2026»
  const periodLabel = month && m.period.kind === 'range' ? monthLabel(month) : m.period.label;
  const actions = (
    <>
      <button
        className="btn btn-green"
        type="button"
        onClick={() =>
          modal.open(<MetricsReportModal metrics={m} shop={catalog.data?.shop} periodLabel={periodLabel} />)
        }
      >
        <PrintIcon />
        Отчёт для печати
      </button>
      <button className="btn btn-ghost" type="button" onClick={() => void exportCsv()}>
        Выгрузить CSV
      </button>
    </>
  );

  if (detail) {
    return (
      <MetricsDetail metrics={m} kind={detail} tabs={tabs} periodLabel={periodLabel} onBack={() => setDetail(null)} />
    );
  }

  const peak = Math.max(...m.series.map((s) => s.sum), 1);
  const weekPeak = Math.max(...m.weekday_load.map((d) => d.count), 1);
  const cash = m.cash;

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead eyebrow={<>Аналитика · {periodLabel}</>} title="Метрики" actions={actions} />
        {tabs}

        <div className="mx-hero">
          <div className="mx-cell accent">
            <div className="k">
              Получено
              <br />
              за период
            </div>
            <div className="v">{moneyOrZero(m.revenue)}</div>
            <Delta value={m.compare.revenue} />
          </div>
          <div className="mx-cell">
            <div className="k">
              Выдано
              <br />
              заказов
            </div>
            <div className="v">{m.orders_done}</div>
            <Delta value={m.compare.orders_done} />
          </div>
          <div className="mx-cell">
            <div className="k">
              Средний
              <br />
              чек
            </div>
            <div className="v">{money(m.avg_check) || '—'}</div>
            <Delta value={m.compare.avg_check} />
          </div>
          <div className={m.done_debt ? 'mx-cell warn' : 'mx-cell'}>
            <div className="k">
              Не доплатили
              <br />
              по выданным
            </div>
            <div className="v">{moneyOrZero(m.done_debt)}</div>
            {m.done_debt_all > m.done_debt && (
              <span className="mx-delta none">всего висит {money(m.done_debt_all)}</span>
            )}
          </div>
          <div className="mx-cell">
            <div className="k">
              Срок
              <br />
              выполнения
            </div>
            <div className="v">
              {m.avg_lead_days !== null ? (
                <>
                  {m.avg_lead_days}
                  <small>дн.</small>
                </>
              ) : (
                '—'
              )}
            </div>
            {m.on_time.rate !== null && (
              <span className={m.on_time.rate >= 85 ? 'mx-delta good' : 'mx-delta bad'}>
                в срок {m.on_time.rate}% · {m.on_time.count} из {m.on_time.total}
              </span>
            )}
          </div>
        </div>

        <Section title={m.by_month ? 'Получено по месяцам' : 'Получено по дням'}>
          {m.series.length === 0 ? (
            <Empty>За период нет выданных заказов</Empty>
          ) : (
            <>
              <div className="mx-chart">
                {m.series.map((point) => (
                  <div
                    className={point.sum ? 'mx-bar has' : 'mx-bar'}
                    key={point.label}
                    style={{ height: `${Math.max((point.sum / peak) * 100, 2)}%` }}
                    title={`${point.label} — ${moneyOrZero(point.sum)} · ${point.count} ${plural(point.count, 'заказ', 'заказа', 'заказов')}`}
                  />
                ))}
              </div>
              <div className="mx-axis">
                <span>{m.series[0].label}</span>
                <span>{m.series[m.series.length - 1].label}</span>
              </div>
            </>
          )}
        </Section>

        {/* касса — по датам платежей, поэтому может не сходиться с «получено»:
            предоплату могли внести раньше, чем заказ выдали */}
        <Section title="Касса за период">
          <div className="mx-hero">
            {(['cash', 'transfer'] as PayMethod[]).map((method) => (
              <div className="mx-cell" key={method}>
                <div className="k">{METHOD_LABEL[method]}</div>
                <div className="v">{moneyOrZero(cash.by_method[method].net)}</div>
                {cash.by_method[method].out > 0 && (
                  <span className="mx-delta none">
                    приняли {money(cash.by_method[method].in)} · вернули {money(cash.by_method[method].out)}
                  </span>
                )}
              </div>
            ))}
            <div className={cash.total_out ? 'mx-cell warn' : 'mx-cell'}>
              <div className="k">Возвраты</div>
              <div className="v">{moneyOrZero(cash.total_out)}</div>
            </div>
            <div className="mx-cell accent">
              <div className="k">Итого в кассу</div>
              <div className="v">{moneyOrZero(cash.total)}</div>
              <span className="mx-delta none">
                {cash.entries} {plural(cash.entries, 'движение', 'движения', 'движений')}
              </span>
            </div>
          </div>
        </Section>

        <Section title="Сейчас в работе">
          <div className="mx-hero">
            <div className="mx-cell">
              <div className="k">
                Заказов
                <br />в работе
              </div>
              <div className="v">
                {m.active_count}
                <small>на {moneyOrZero(m.active_sum)}</small>
              </div>
            </div>
            <div className="mx-cell">
              <div className="k">
                Ждём
                <br />
                доплаты
              </div>
              <div className="v">{moneyOrZero(m.debt)}</div>
              <span className="mx-delta none">предоплат в кассе {moneyOrZero(m.prepaid_held)}</span>
            </div>
            <div className={m.overdue_count ? 'mx-cell warn' : 'mx-cell'}>
              <div className="k">
                Просрочено
                <br />/ сегодня
              </div>
              <div className="v">
                {m.overdue_count}
                <small>/ сегодня {m.due_today_count}</small>
              </div>
            </div>
            <div className={m.no_price_count ? 'mx-cell warn' : 'mx-cell'}>
              <div className="k">
                Без цены
                <br />в работе
              </div>
              <div className="v">{m.no_price_count}</div>
            </div>
            <button
              className={m.stale.length ? 'mx-cell warn as-btn' : 'mx-cell as-btn'}
              type="button"
              onClick={() => setDetail('stale')}
            >
              <div className="k">
                Без движения
                <br />
                {m.stale_days}+ дней
              </div>
              <div className="v">{m.stale.length}</div>
              <span className="mx-delta none">открыть список →</span>
            </button>
          </div>
        </Section>

        <div className="mx-cols four">
          <button className="mx-open" type="button" onClick={() => setDetail('templates')}>
            <span className="k">По видам работ</span>
            <span className="v">
              {m.by_template.length} <small>{m.by_template.length ? plural(m.by_template.length, 'вид', 'вида', 'видов') : '—'}</small>
            </span>
            <span className="go">
              Открыть разбор <ArrowIcon />
            </span>
          </button>
          <button className="mx-open" type="button" onClick={() => setDetail('clients')}>
            <span className="k">Клиенты по выручке</span>
            <span className="v">
              {m.clients_total} <small>{plural(m.clients_total, 'клиент', 'клиента', 'клиентов')}</small>
            </span>
            <span className="go">
              Открыть список <ArrowIcon />
            </span>
          </button>
          <button className="mx-open" type="button" onClick={() => setDetail('managers')}>
            <span className="k">По сотрудникам</span>
            <span className="v">
              {m.by_manager.length} <small>{plural(m.by_manager.length, 'человек', 'человека', 'человек')}</small>
            </span>
            <span className="go">
              Кто сколько принёс <ArrowIcon />
            </span>
          </button>
          <button className={m.debtors.length ? 'mx-open warn' : 'mx-open'} type="button" onClick={() => setDetail('debtors')}>
            <span className="k">Должники</span>
            <span className="v">
              {m.debtors.length}{' '}
              <small>{m.debtors.length ? `на ${money(m.debtors.reduce((a, d) => a + d.debt, 0))}` : 'все рассчитались'}</small>
            </span>
            <span className="go">
              Кому звонить <ArrowIcon />
            </span>
          </button>
        </div>

        <Section title="Клиенты: новые и повторные">
          <div className="mx-hero">
            <div className="mx-cell">
              <div className="k">
                Новых
                <br />
                клиентов
              </div>
              <div className="v">{m.clients.new}</div>
              <Delta value={m.compare.clients_new} />
            </div>
            <div className="mx-cell">
              <div className="k">
                Вернулись
                <br />
                снова
              </div>
              <div className="v">{m.clients.returning}</div>
              <span className="mx-delta none">принесли {moneyOrZero(m.clients.returning_sum)}</span>
            </div>
            <div className="mx-cell accent">
              <div className="k">
                Выручка от
                <br />
                повторных
              </div>
              <div className="v">{m.clients.returning_share !== null ? `${m.clients.returning_share}%` : '—'}</div>
              <span className="mx-delta none">новые принесли {moneyOrZero(m.clients.new_sum)}</span>
            </div>
          </div>
        </Section>

        <div className="mx-cols">
          <Section title="Когда приходят заказы">
            <div className="mx-week">
              {m.weekday_load.map((d) => (
                <div className="mx-week-day" key={d.label} title={`${d.count} ${plural(d.count, 'заказ', 'заказа', 'заказов')} на ${moneyOrZero(d.sum)}`}>
                  <div className="track">
                    <span style={{ height: `${Math.max((d.count / weekPeak) * 100, 3)}%` }} />
                  </div>
                  <b>{d.count}</b>
                  <em>{d.label}</em>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Заявки за период">
            <ul className="mx-list">
              <li>
                <span className="nm">Создано заказов</span>
                <span className="sm">
                  {m.created_count} <Delta value={m.compare.created_count} />
                </span>
              </li>
              <li>
                <span className="nm">Отменено</span>
                <span className="sm">
                  {m.cancelled_count} · {m.cancel_rate}% <Delta value={m.compare.cancelled_count} invert />
                </span>
              </li>
              {m.cancel_reasons.map((r) => (
                <li className="sub" key={r.reason}>
                  <span className="nm">— {r.reason}</span>
                  <span className="ct">{r.count}</span>
                </li>
              ))}
              <li>
                <span className="nm">Доп. услуги в выданных</span>
                <span className="sm">
                  {moneyOrZero(m.extras_sum)} <small>· {m.extras_share}% · {m.extras_orders} {plural(m.extras_orders, 'заказ', 'заказа', 'заказов')}</small>
                </span>
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </main>
  );
}

/** Разбор одного разреза: виды работ, клиенты, сотрудники, должники, зависшие. */
function MetricsDetail({
  metrics,
  kind,
  tabs,
  periodLabel,
  onBack,
}: {
  metrics: Metrics;
  kind: Exclude<Detail, null>;
  tabs: React.ReactNode;
  periodLabel: string;
  onBack: () => void;
}) {
  const titles: Record<Exclude<Detail, null>, string> = {
    templates: 'Виды работ',
    clients: 'Клиенты',
    managers: 'Сотрудники',
    debtors: 'Должники',
    stale: 'Без движения',
  };

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <button className="pr-back" type="button" onClick={onBack}>
          <ArrowIcon /> Все метрики
        </button>
        <PageHead eyebrow={<>Аналитика · {periodLabel}</>} title={titles[kind]} />
        {tabs}
        {kind === 'templates' || kind === 'clients' ? (
          <RankDetail metrics={metrics} kind={kind} />
        ) : kind === 'managers' ? (
          <ManagersDetail metrics={metrics} />
        ) : kind === 'debtors' ? (
          <DebtorsDetail rows={metrics.debtors} />
        ) : (
          <StaleDetail rows={metrics.stale} days={metrics.stale_days} />
        )}
      </div>
    </main>
  );
}

function RankDetail({ metrics, kind }: { metrics: Metrics; kind: 'templates' | 'clients' }) {
  const rows =
    kind === 'clients'
      ? metrics.top_clients.map((c) => ({ name: c.name, count: c.count, sum: c.sum, lead: null as number | null }))
      : metrics.by_template.map((t) => ({ name: t.title, count: t.count, sum: t.sum, lead: t.avg_lead_days }));

  const total = rows.reduce((acc, row) => acc + row.sum, 0);
  const peak = Math.max(...rows.map((r) => r.sum), 1);

  return (
    <>
      <div className="mx-sum">
        <span>Всего за период</span>
        <b>{moneyOrZero(total)}</b>
        <span className="cnt">
          {rows.length}{' '}
          {kind === 'clients' ? plural(rows.length, 'клиент', 'клиента', 'клиентов') : plural(rows.length, 'вид', 'вида', 'видов')}
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty>За этот период нет выданных заказов</Empty>
      ) : (
        <div className="mx-rank">
          {rows.map((row, i) => (
            <div className="mx-rank-row" key={`${row.name}-${i}`}>
              <span className="i">{i + 1}</span>
              <div className="body">
                <div className="line">
                  <span className="nm">{row.name}</span>
                  <span className="sm">{moneyOrZero(row.sum)}</span>
                </div>
                <div className="track">
                  <span style={{ width: `${Math.max((row.sum / peak) * 100, 1.5)}%` }} />
                </div>
                <div className="meta">
                  <span>
                    {row.count} {plural(row.count, 'заказ', 'заказа', 'заказов')}
                  </span>
                  <span>{total ? Math.round((row.sum / total) * 100) : 0}% полученного</span>
                  <span>средний {money(row.count ? row.sum / row.count : 0) || '—'}</span>
                  {row.lead !== null && <span>срок {row.lead} дн.</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ManagersDetail({ metrics }: { metrics: Metrics }) {
  const rows = metrics.by_manager;
  const total = rows.reduce((a, r) => a + r.sum, 0);
  if (rows.length === 0) return <Empty>За период никто не принимал и не выдавал заказы</Empty>;
  return (
    <>
      <p className="mx-note">
        «Принял» — заказы, оформленные за период; «получено» — деньги по заказам, которые сотрудник принял и
        которые выдали за период. Это разные заказы, поэтому колонки не складываются друг в друга.
      </p>
      <table className="cash-table mx-table">
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
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="num">{r.created}</td>
              <td className="num">{r.done}</td>
              <td className="num">
                <b>{moneyOrZero(r.sum)}</b>
              </td>
              <td className="num">{total ? Math.round((r.sum / total) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DebtorsDetail({ rows }: { rows: MetricsDebtor[] }) {
  const openOrder = useOpenOrder();
  const total = rows.reduce((a, r) => a + r.debt, 0);
  if (rows.length === 0) return <Empty>Долгов нет — все выданные заказы оплачены.</Empty>;
  return (
    <>
      <div className="mx-sum">
        <span>Не доплатили</span>
        <b>{moneyOrZero(total)}</b>
        <span className="cnt">
          {rows.length} {plural(rows.length, 'заказ', 'заказа', 'заказов')}
        </span>
      </div>
      <p className="mx-note">
        Сначала выданные с недоплатой — эти деньги уже ничем не обеспечены. Дальше заказы в работе, у которых
        срок прошёл, а внесено не всё. Нажмите строку, чтобы открыть заказ.
      </p>
      <div className="mx-rows" role="list">
        {rows.map((r) => (
          <button className="mx-row" type="button" role="listitem" key={r.order_id} onClick={() => openOrder(r.order_id)}>
            <span className="num">{r.number}</span>
            <span className="who">
              <b>{r.client}</b>
              <span>{r.title}</span>
            </span>
            <span className="tag">
              {r.kind === 'done' ? 'выдан' : 'просрочен'} · {r.days} {plural(r.days, 'день', 'дня', 'дней')}
            </span>
            <span className="sum">
              <b>{money(r.debt)}</b>
              <span>из {money(r.price)}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function StaleDetail({ rows, days }: { rows: MetricsStaleOrder[]; days: number }) {
  const openOrder = useOpenOrder();
  const catalog = useCatalog();
  const statusTitle = (key: string) => catalog.data?.statuses.find((s) => s.key === key)?.title ?? key;
  if (rows.length === 0) return <Empty>Все заказы в работе кто-то трогал за последние {days} дней.</Empty>;
  return (
    <>
      <p className="mx-note">
        Заказы в работе, к которым никто не прикасался {days} и больше дней: не просроченные по сроку, а
        забытые — на доске их не видно ни в одном фильтре.
      </p>
      <div className="mx-rows" role="list">
        {rows.map((r) => (
          <button className="mx-row" type="button" role="listitem" key={r.order_id} onClick={() => openOrder(r.order_id)}>
            <span className="num">{r.number}</span>
            <span className="who">
              <b>{r.title}</b>
              <span>{r.client || 'без клиента'}</span>
            </span>
            <span className="tag">{statusTitle(r.status)}</span>
            <span className="sum">
              <b>
                {r.days} {plural(r.days, 'день', 'дня', 'дней')}
              </b>
              <span>{money(r.price) || 'без цены'}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
