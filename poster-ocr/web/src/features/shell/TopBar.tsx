/* Шапка: кнопка меню разделов, логотип по центру, счётчик денег в работе,
   новый заказ, тема и профиль.

   Разделы переехали в выдвижную панель слева (NavDrawer): иконками в шапке
   их набралось столько, что на средних экранах они теснили кнопки справа.
   Поиска здесь тоже нет — он в полосе фильтров доски. */

import { useCallback, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { useMailStore } from '@/api/mail';
import { useOrders } from '@/api/orders';
import type { OrdersFilter } from '@/api/keys';
import { useAuth } from '@/app/AuthProvider';
import { toggleTheme, useTheme } from '@/app/theme';
import { useModal } from '@/app/ModalProvider';
import { MenuIcon, MoonIcon, PlusIcon, SunIcon } from '@/components/Icons';
import { CashModal } from '@/features/cash/CashModal';
import { useNewOrder } from '@/features/orders/useNewOrder';
import { moneyOrZero } from '@/lib/format';

import { NavDrawer } from './NavDrawer';

interface TopBarProps {
  filter: OrdersFilter;
  /** «новый заказ» относится только к доске */
  onBoard: boolean;
}

export function TopBar({ filter, onBoard }: TopBarProps) {
  const { session, can } = useAuth();
  const newOrder = useNewOrder();
  const mail = useMailStore();
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <>
      <header className="topbar">
        <div className="tb-left">
          <button
            ref={menuButton}
            className="icon-btn menu-btn"
            type="button"
            title="Разделы"
            aria-label="Открыть меню разделов"
            aria-expanded={menuOpen}
            aria-controls="nav-drawer"
            onClick={() => setMenuOpen(true)}
          >
            <MenuIcon />
            {/* непрочитанные письма видно и при закрытом меню */}
            {mail.unseen > 0 && (
              <i className="nav-badge" aria-label={`${mail.unseen} непрочитанных`}>
                {mail.unseen > 99 ? '99+' : mail.unseen}
              </i>
            )}
          </button>
          <div className="spotbar" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="brand">
          ПОСТЕР<span className="dot">.</span>
        </div>

        <div className="tb-right">
          {can('finance.totals') && <ActiveCounter filter={filter} cash={can('finance.cash')} />}
          {onBoard && can('orders.create') && (
            <button className="btn btn-green" type="button" onClick={newOrder}>
              <PlusIcon />
              <span className="btn-label">Новый заказ</span>
            </button>
          )}
          {/* тема — свойство экрана, не профиля: хранится в браузере */}
          <button
            className="icon-btn theme-toggle"
            type="button"
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
            onClick={(e) => toggleTheme({ x: e.clientX, y: e.clientY })}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
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
      {/* вне шапки: у неё свой z-index, внутри него панель не встала бы
          поверх доски и уведомлений */}
      <NavDrawer open={menuOpen} onClose={closeMenu} trigger={menuButton} />
    </>
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
