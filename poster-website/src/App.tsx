/* Каркас сайта-визитки: шапка с навигацией, страницы, подвал.

   Это заготовка — структура и стили, которые заменятся настоящим дизайном.
   Ссылка на систему ведёт на /poster-crm/: на сервере это отдельное
   приложение за тем же Caddy, в разработке — прокси на локальный uvicorn
   (vite.config.ts). */

import { NavLink, Route, Routes } from 'react-router-dom';

const CRM_URL = '/poster-crm/';

const NAV = [
  { to: '/', label: 'Главная' },
  { to: '/uslugi', label: 'Услуги' },
  { to: '/kontakty', label: 'Контакты' },
];

export function App() {
  return (
    <div className="site">
      <header className="site-head">
        <NavLink to="/" className="logo">
          Печатная мастерская
        </NavLink>
        <nav aria-label="Разделы сайта">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        {/* обычная ссылка, не NavLink: это другой сайт, React Router о нём не знает */}
        <a className="staff" href={CRM_URL}>
          Вход для сотрудников
        </a>
      </header>

      <main className="site-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/uslugi" element={<Services />} />
          <Route path="/kontakty" element={<Contacts />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="site-foot">© {new Date().getFullYear()} Печатная мастерская</footer>
    </div>
  );
}

function Home() {
  return (
    <section className="hero">
      <h1>Печать, которая не подводит</h1>
      <p>Баннеры, наклейки, визитки и полиграфия. С макетом или без — поможем.</p>
      <NavLink className="btn" to="/kontakty">
        Связаться
      </NavLink>
    </section>
  );
}

function Services() {
  const items = ['Широкоформатная печать', 'Наклейки и этикетки', 'Визитки и листовки', 'Постпечать'];
  return (
    <section>
      <h1>Услуги</h1>
      <ul className="cards">
        {items.map((title) => (
          <li key={title}>{title}</li>
        ))}
      </ul>
    </section>
  );
}

function Contacts() {
  return (
    <section>
      <h1>Контакты</h1>
      <p>Адрес, телефон и часы работы появятся здесь.</p>
    </section>
  );
}

function NotFound() {
  return (
    <section>
      <h1>Страницы нет</h1>
      <p>
        Такого адреса на сайте нет. <NavLink to="/">На главную</NavLink>
      </p>
    </section>
  );
}
