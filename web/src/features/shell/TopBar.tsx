/* Шапка: бренд, разделы, поиск, счётчик денег в работе, профиль. */

import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';

import { useOrders } from '@/api/orders';
import type { OrdersFilter } from '@/api/keys';
import { useAuth } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { VIEWS } from '@/app/views';
import { PlusIcon, SearchIcon } from '@/components/Icons';
import { useNewOrder } from '@/features/orders/useNewOrder';
import { moneyOrZero } from '@/lib/format';

interface TopBarProps {
  filter: OrdersFilter;
  query: string;
  onQueryChange: (value: string) => void;
  /** поиск, фильтры и «новый заказ» относятся только к доске */
  showSearch: boolean;
}

export function TopBar({ filter, query, onQueryChange, showSearch }: TopBarProps) {
  const { session, can, signOut } = useAuth();
  const askConfirm = useConfirm();
  const newOrder = useNewOrder();
  // вкладка показывается, только если у профиля есть право на раздел
  const views = VIEWS.filter((view) => !view.permission || can(view.permission));
  const searchRef = useRef<HTMLInputElement>(null);

  // «/» — быстрый переход в поиск. Не перехватываем, если человек уже
  // печатает в каком-нибудь поле: слэш там нужен как символ.
  useEffect(() => {
    if (!showSearch) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement;
      if (typing) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showSearch]);

  const changeProfile = async () => {
    const ok = await askConfirm({
      eyebrow: session?.name ?? '',
      title: 'Сменить профиль?',
      text: 'Вы вернётесь к экрану выбора. Несохранённые изменения в открытых окнах пропадут.',
      yes: 'Выйти',
      no: 'Остаться',
    });
    if (ok) signOut();
  };

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

      <nav className="tb-nav" aria-label="Разделы">
        {views.map((view) => (
          <NavLink
            className={({ isActive }) => (isActive ? 'nav-tab active' : 'nav-tab')}
            to={view.path}
            key={view.key}
            title={view.label}
          >
            <view.icon />
            <span>{view.label}</span>
          </NavLink>
        ))}
      </nav>

      {showSearch && (
        <div className="tb-search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Номер, клиент, телефон…"
            autoComplete="off"
            aria-label="Поиск заказов"
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
      )}

      <div className="tb-right">
        {can('finance.totals') && <ActiveCounter filter={filter} />}
        {showSearch && can('orders.create') && (
          <button className="btn btn-green" type="button" onClick={newOrder}>
            <PlusIcon />
            Новый заказ
          </button>
        )}
        <button
          className={session?.kind === 'admin' ? 'profile-chip admin' : 'profile-chip'}
          type="button"
          title="Сменить профиль"
          onClick={changeProfile}
        >
          <span className="pc-dot" />
          <span>{session?.name || 'Профиль'}</span>
        </button>
      </div>
    </header>
  );
}

/** Сколько заказов в работе и на какую сумму.
 *
 *  Считается по тому же списку, что показан на доске, — значит уважает
 *  выбранный фильтр и поиск. Отдельного запроса не делает: ключ кэша тот же,
 *  что у доски, данные берутся из памяти. */
function ActiveCounter({ filter }: { filter: OrdersFilter }) {
  const { data } = useOrders(filter);
  const active = (data ?? []).filter((o) => o.status !== 'done' && o.status !== 'cancelled');
  const sum = active.reduce((acc, o) => acc + (o.price || 0), 0);

  return (
    <div className="counter" title="Активные заказы и их сумма">
      <b>{active.length}</b>
      <span>
        в работе · <em>{moneyOrZero(sum)}</em>
      </span>
    </div>
  );
}
