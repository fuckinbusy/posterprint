/* Шапка: знак слева, разделы справа. Сайт — одна длинная страница, пункты
   меню — якоря на её разделы; пункт раздела, который сейчас на экране,
   подсвечивается зелёным, как на старом сайте. На узком экране меню
   сворачивается в кнопку. */

import { useEffect, useState } from 'react';

import { Brand } from '@/components/Brand';
import { IconClose, IconMenu } from '@/components/Icons';
import { NAV } from '@/content';

/* Раздел считается текущим, когда пересекает полосу чуть выше середины
   экрана: так подсветка переключается, когда заголовок раздела дошёл до
   глаз, а не когда его край только показался снизу.

   Следим за всеми разделами страницы, а не только за пунктами меню: иначе
   на разделе без пункта («Нам доверяют», первый экран) горел бы пункт
   предыдущего раздела. */
function useActiveSection() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    document.querySelectorAll('main section[id]').forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return active;
}

export function Header() {
  const active = useActiveSection();
  const [menuOpen, setMenuOpen] = useState(false);

  // открытое меню закрывается по Esc
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <Brand />
      <button
        className="icon-btn menu-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="site-nav"
        aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <IconClose /> : <IconMenu />}
      </button>
      <nav id="site-nav" className={`topnav${menuOpen ? ' open' : ''}`} aria-label="Разделы сайта">
        {NAV.map((item) => (
          <a
            key={item.id}
            href={`/#${item.id}`}
            className={active === item.id ? 'active' : undefined}
            aria-current={active === item.id ? 'location' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
