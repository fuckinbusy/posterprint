/* Шапка: бренд, разделы, счётчик денег в работе, профиль.

   Поиска здесь больше нет — он переехал в полосу фильтров доски. В шапке
   он делил место с разделами, и на средних экранах кнопки справа уезжали
   за край, приходилось скроллить. */

import { NavLink } from 'react-router-dom';

import { useOrders } from '@/api/orders';
import type { OrdersFilter } from '@/api/keys';
import { useAuth } from '@/app/AuthProvider';
import { useModal } from '@/app/ModalProvider';
import { VIEWS } from '@/app/views';
import { PlusIcon } from '@/components/Icons';
import { CashModal } from '@/features/cash/CashModal';
import { useNewOrder } from '@/features/orders/useNewOrder';
import { moneyOrZero } from '@/lib/format';

interface TopBarProps {
  filter: OrdersFilter;
  /** «новый заказ» относится только к доске */
  onBoard: boolean;
}

export function TopBar({ filter, onBoard }: TopBarProps) {
  const { session, can } = useAuth();
  const newOrder = useNewOrder();
  // вкладка показывается, только если у профиля есть право на раздел
  const views = VIEWS.filter((view) => !view.permission || can(view.permission));

  return (
    <header className="topbar">
      <div className="tb-left">
        <div className="brand">
          <span className="reg" aria-hidden="true">
            <i />
          </span>
          <span>
            ПОСТЕР<span className="dot">.</span>
            <small>ЦЕХ · ЗАКАЗЫ</small>
          </span>
        </div>
        <div className="spotbar" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      {/* Разделы — иконками; при наведении кнопка раскрывается вправо и
          показывает название. Так они помещаются на любой ширине, и ничего
          не нужно скроллить. */}
      <nav className="tb-nav" aria-label="Разделы">
        {views.map((view) => (
          <NavLink
            className={({ isActive }) => (isActive ? 'nav-tab active' : 'nav-tab')}
            to={view.path}
            key={view.key}
          >
            <view.icon />
            <span>{view.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="tb-right">
        {can('finance.totals') && <ActiveCounter filter={filter} cash={can('finance.cash')} />}
        {onBoard && can('orders.create') && (
          <button className="btn btn-green" type="button" onClick={newOrder}>
            <PlusIcon />
            Новый заказ
          </button>
        )}
        {/* имя ведёт на страницу профиля: там смена профиля, настройки
            этого рабочего места и что разрешено */}
        <NavLink
          className={({ isActive }) =>
            ['profile-chip', session?.kind === 'admin' ? 'admin' : '', isActive ? 'active' : ''].filter(Boolean).join(' ')
          }
          to="/profile"
          title="Профиль и настройки этого рабочего места"
        >
          <span className="pc-dot" />
          <span>{session?.name || 'Профиль'}</span>
        </NavLink>
      </div>
    </header>
  );
}

/** Сколько заказов в работе и на какую сумму.
 *
 *  Считается по тому же списку, что показан на доске, — значит уважает
 *  выбранный фильтр и поиск. Отдельного запроса не делает: ключ кэша тот же,
 *  что у доски, данные берутся из памяти. */
function ActiveCounter({ filter, cash }: { filter: OrdersFilter; cash: boolean }) {
  const { data } = useOrders(filter);
  const modal = useModal();
  const active = (data ?? []).filter((o) => o.status !== 'done' && o.status !== 'cancelled');
  const sum = active.reduce((acc, o) => acc + (o.price || 0), 0);

  const body = (
    <>
      <b>{active.length}</b>
      <span>
        в работе · <em>{moneyOrZero(sum)}</em>
      </span>
    </>
  );
  // касса за день — по своему праву finance.cash: суммы в работе видят
  // несколько человек, а ящик вечером сверяет один
  if (!cash) {
    return (
      <div className="counter" title="Активные заказы и их сумма">
        {body}
      </div>
    );
  }
  return (
    <button
      className="counter"
      type="button"
      title="Активные заказы и их сумма. Нажмите — касса за день"
      onClick={() => modal.open(<CashModal />)}
    >
      {body}
    </button>
  );
}
