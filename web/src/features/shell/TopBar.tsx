/* Шапка: бренд, разделы, счётчик денег в работе, профиль.

   Поиска здесь больше нет — он переехал в полосу фильтров доски. В шапке
   он делил место с разделами, и на средних экранах кнопки справа уезжали
   за край, приходилось скроллить. */

import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { useOrders } from '@/api/orders';
import type { OrdersFilter } from '@/api/keys';
import { useAuth } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { VIEWS } from '@/app/views';
import { PlusIcon } from '@/components/Icons';
import { useNewOrder } from '@/features/orders/useNewOrder';
import { moneyOrZero } from '@/lib/format';

interface TopBarProps {
  filter: OrdersFilter;
  /** «новый заказ» относится только к доске */
  onBoard: boolean;
}

export function TopBar({ filter, onBoard }: TopBarProps) {
  const { session, can, signOut } = useAuth();
  const askConfirm = useConfirm();
  const newOrder = useNewOrder();
  // вкладка показывается, только если у профиля есть право на раздел
  const views = VIEWS.filter((view) => !view.permission || can(view.permission));
  const nav = useCompactNav(views.length);

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

      <nav className={nav.compact ? 'tb-nav compact' : 'tb-nav'} aria-label="Разделы" ref={nav.ref}>
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

      <div className="tb-right">
        {can('finance.totals') && <ActiveCounter filter={filter} />}
        {onBoard && can('orders.create') && (
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

/* Разделы никогда не уезжают за край и не скроллятся: если с подписями не
   помещаются — остаются только иконки, подпись уходит в подсказку. Раньше
   порог был зашит в медиазапрос, и при восьми разделах на средних экранах
   половину приходилось искать прокруткой — ни сотрудники, ни админ этого не
   ожидали. */
function useCompactNav(count: number) {
  const ref = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return undefined;
    const measure = () => {
      const bar = nav.parentElement;
      if (!bar) return;
      const room = () =>
        bar.clientWidth -
        [...bar.children]
          .filter((c) => c !== nav)
          .reduce((acc, c) => acc + (c as HTMLElement).offsetWidth, 0) -
        60;
      // Ширину с подписями меряем каждый раз заново, сняв сжатие на миг:
      // кэшировать её нельзя — шрифты догружаются, разделы меняются.
      nav.classList.remove('compact');
      bar.classList.remove('tight');
      const full = nav.scrollWidth;
      // Подписи важнее счётчика «в работе»: сначала прячем его, и только
      // если и без него не помещается — уходим в иконки.
      let need = full > room();
      if (need) {
        bar.classList.add('tight');
        need = full > room();
      }
      nav.classList.toggle('compact', need);
      setCompact(need);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav.parentElement ?? nav);
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [count]);

  return { compact, ref };
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
