/* Раздел «Метрики».

   Выручка считается по моменту перехода заказа в «Выдан»: у заказа для
   этого есть отметка completed_at. Если вернуть заказ из «Выдан» назад,
   отметка снимается — и из выручки он уходит. */

import { useState } from 'react';

import { useMetrics } from '@/api/metrics';
import { ArrowIcon } from '@/components/Icons';
import { Empty, Loading, PageHead, Section } from '@/components/ui';
import { money, moneyOrZero, plural } from '@/lib/format';
import type { Metrics } from '@/types/api';

const PERIODS = [
  { days: 7, label: 'Неделя' },
  { days: 30, label: 'Месяц' },
  { days: 90, label: 'Квартал' },
  { days: 365, label: 'Год' },
  { days: 0, label: 'Всё время' },
];

/** Какой разрез открыт вместо общей сводки. */
type Detail = 'templates' | 'clients' | null;

export function MetricsPage() {
  const [days, setDays] = useState(30);
  const [detail, setDetail] = useState<Detail>(null);
  const metrics = useMetrics(days);

  const tabs = (
    <div className="mx-tabs">
      {PERIODS.map((period) => (
        <button
          className={period.days === days ? 'active' : ''}
          type="button"
          key={period.days}
          onClick={() => setDays(period.days)}
        >
          {period.label}
        </button>
      ))}
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

  if (detail) {
    return (
      <MetricsDetail
        metrics={m}
        kind={detail}
        tabs={tabs}
        onBack={() => setDetail(null)}
      />
    );
  }

  const peak = Math.max(...m.series.map((s) => s.sum), 1);

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead eyebrow={<>Аналитика · {m.period.label}</>} title="Метрики" />
        {tabs}

        <div className="mx-hero">
          <div className="mx-cell accent">
            <div className="k">
              Получено
              <br />
              за период
            </div>
            <div className="v">{moneyOrZero(m.revenue)}</div>
          </div>
          <div className="mx-cell">
            <div className="k">
              Выдано
              <br />
              заказов
            </div>
            <div className="v">{m.orders_done}</div>
          </div>
          <div className={m.done_debt ? 'mx-cell warn' : 'mx-cell'}>
            <div className="k">
              Не доплатили
              <br />
              по выданным
            </div>
            <div className="v">{moneyOrZero(m.done_debt)}</div>
          </div>
          <div className="mx-cell">
            <div className="k">
              Средний
              <br />
              чек
            </div>
            <div className="v">{money(m.avg_check) || '—'}</div>
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
                    title={`${point.label} — ${moneyOrZero(point.sum)}`}
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

        <div className="mx-hero">
          <div className="mx-cell">
            <div className="k">
              Сейчас
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
        </div>

        <div className="mx-cols">
          <button className="mx-open" type="button" onClick={() => setDetail('templates')}>
            <span className="k">По видам работ</span>
            <span className="v">
              {m.by_template.length} <small>{m.by_template.length ? 'вида в работе' : '—'}</small>
            </span>
            <span className="go">
              Открыть разбор <ArrowIcon />
            </span>
          </button>
          <button className="mx-open" type="button" onClick={() => setDetail('clients')}>
            <span className="k">Клиенты по выручке</span>
            <span className="v">
              {m.clients_total}{' '}
              <small>{plural(m.clients_total, 'клиент', 'клиента', 'клиентов')}</small>
            </span>
            <span className="go">
              Открыть список <ArrowIcon />
            </span>
          </button>
        </div>

        <Section title="Заявки за период">
          <ul className="mx-list">
            <li>
              <span className="nm">Создано заказов</span>
              <span className="sm">{m.created_count}</span>
            </li>
            <li>
              <span className="nm">Отменено</span>
              <span className="sm">
                {m.cancelled_count} · {m.cancel_rate}%
              </span>
            </li>
            <li>
              <span className="nm">Предоплат в кассе по активным</span>
              <span className="sm">{moneyOrZero(m.prepaid_held)}</span>
            </li>
          </ul>
        </Section>
      </div>
    </main>
  );
}

/** Разбор одного разреза: по видам работ или по клиентам. */
function MetricsDetail({
  metrics,
  kind,
  tabs,
  onBack,
}: {
  metrics: Metrics;
  kind: 'templates' | 'clients';
  tabs: React.ReactNode;
  onBack: () => void;
}) {
  const rows =
    kind === 'clients'
      ? metrics.top_clients.map((c) => ({ name: c.name, count: c.count, sum: c.sum }))
      : metrics.by_template.map((t) => ({ name: t.title, count: t.count, sum: t.sum }));

  const total = rows.reduce((acc, row) => acc + row.sum, 0);
  const peak = Math.max(...rows.map((r) => r.sum), 1);

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <button className="pr-back" type="button" onClick={onBack}>
          <ArrowIcon /> Все метрики
        </button>

        <PageHead
          eyebrow={<>Аналитика · {metrics.period.label}</>}
          title={kind === 'clients' ? 'Клиенты' : 'Виды работ'}
        />
        {tabs}

        <div className="mx-sum">
          <span>Всего за период</span>
          <b>{moneyOrZero(total)}</b>
          <span className="cnt">
            {rows.length}{' '}
            {kind === 'clients'
              ? plural(rows.length, 'клиент', 'клиента', 'клиентов')
              : plural(rows.length, 'вид', 'вида', 'видов')}
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
