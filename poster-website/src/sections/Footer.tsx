/* Подвал. «Вход для сотрудников» ведёт в систему (CRM) — отдельное
   приложение на своём поддомене (crm.домен). Адрес приходит при сборке из
   VITE_CRM_URL (docker-compose.yml берёт его из POSTER_CRM_DOMAIN). В
   разработке — /poster-crm/, его vite проксирует на локальный uvicorn
   (vite.config.ts). Собранный без адреса сайт ссылку не показывает: вести
   ей некуда. Обычная <a>, не NavLink: React Router о другом приложении не
   знает. */

import { Brand, SpotBar } from '@/components/Brand';
import { CONTACTS, NAV } from '@/content';

const CRM_URL: string = import.meta.env.VITE_CRM_URL || (import.meta.env.DEV ? '/poster-crm/' : '');

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
        {CRM_URL && (
          <a className="staff" href={CRM_URL}>
            Вход для сотрудников
          </a>
        )}
      </div>
    </footer>
  );
}
