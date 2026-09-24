/* Меню разделов — панель, выезжающая слева.

   Раньше разделы стояли иконками в шапке и на средних экранах теснили
   кнопки справа, а на телефоне уезжали во вторую строку. С переходом в
   панель у каждого раздела есть полное название, и места хватает с запасом
   на новые (с «Инструментов» их уже десять).

   Панель рисуется всегда и просто уезжает за край: так работает анимация.
   Закрытая получает inert — её ссылки не ловят Tab и не читаются экранным
   диктором. Закрывается выбором раздела, Esc, щелчком мимо и любой сменой
   адреса (например, переходом в профиль из шапки). */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { useMailStore } from '@/api/mail';
import { useAuth } from '@/app/AuthProvider';
import { VIEWS } from '@/app/views';
import { CloseIcon } from '@/components/Icons';

interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
  /** кнопка, открывшая меню: при закрытии фокус возвращается на неё */
  trigger: RefObject<HTMLButtonElement | null>;
}

export function NavDrawer({ open, onClose, trigger }: NavDrawerProps) {
  const { can } = useAuth();
  const mail = useMailStore();
  const location = useLocation();
  const panel = useRef<HTMLElement>(null);
  // раздел показывается, только если у профиля есть на него право
  const views = VIEWS.filter((view) => !view.permission || can(view.permission));

  // смена адреса — любым путём — закрывает меню
  useEffect(() => {
    onClose();
    // onClose намеренно не в зависимостях: реагируем только на адрес
  }, [location.pathname]);

  /* Фокус внутри уезжающей панели потерялся бы (inert сбрасывает его на
     body) — возвращаем на кнопку меню до того, как панель закроется. */
  const close = () => {
    if (panel.current?.contains(document.activeElement)) trigger.current?.focus();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    // фокус — на текущий раздел: с клавиатуры отсюда ближе всего к соседним
    const box = panel.current;
    const current = box?.querySelector<HTMLElement>('.nd-link.active') ?? box?.querySelector<HTMLElement>('.nd-link');
    current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (box?.contains(document.activeElement)) trigger.current?.focus();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, trigger]);

  return (
    <>
      <div className={open ? 'nav-backdrop open' : 'nav-backdrop'} onClick={close} aria-hidden="true" />
      <aside
        id="nav-drawer"
        ref={panel}
        className={open ? 'nav-drawer open' : 'nav-drawer'}
        aria-label="Разделы"
        inert={!open}
      >
        <div className="nd-head">
          <span className="nd-title">Разделы</span>
          <button className="icon-btn" type="button" aria-label="Закрыть меню" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        <nav className="nd-nav">
          {views.map((view) => (
            <NavLink
              className={({ isActive }) => (isActive ? 'nd-link active' : 'nd-link')}
              to={view.path}
              key={view.key}
              onClick={close}
            >
              <view.icon />
              <span>{view.label}</span>
              {view.key === 'mail' && mail.unseen > 0 && (
                <i className="nav-badge" aria-label={`${mail.unseen} непрочитанных`}>
                  {mail.unseen > 99 ? '99+' : mail.unseen}
                </i>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
