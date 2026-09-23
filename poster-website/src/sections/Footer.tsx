/* Подвал. Ссылка на систему ведёт на /poster-crm/: на сервере это
   отдельное приложение за тем же Caddy, в разработке — прокси на локальный
   uvicorn (vite.config.ts). Обычная <a>, не NavLink: React Router о другом
   приложении не знает. */

import { Brand, SpotBar } from '@/components/Brand';
import { CONTACTS, NAV } from '@/content';

const CRM_URL = '/poster-crm/';

export function Footer() {
  return (
    <footer className="site-foot">
      <div className="wrap foot">
        <div className="foot-brand">
          <Brand />
          <SpotBar />
          <p>Успехов на вашем пути!</p>
        </div>
        <nav className="foot-nav" aria-label="Разделы сайта">
          {NAV.map((item) => (
            <a key={item.id} href={`/#${item.id}`}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="foot-contacts">
          <a href={CONTACTS.phoneHref}>{CONTACTS.phone}</a>
          <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a>
          <span>
            {CONTACTS.city}, {CONTACTS.street}
          </span>
        </div>
      </div>
      <div className="wrap foot-bottom">
        <span>
          © {new Date().getFullYear()} {CONTACTS.company} · Реклама &amp; полиграфия
        </span>
        <a className="staff" href={CRM_URL}>
          Вход для сотрудников
        </a>
      </div>
    </footer>
  );
}
