import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import './styles.css';

/* Обычные адреса (/uslugi, /kontakty), а не после «#»: сайту-визитке важно
 * индексироваться. Сервер (Caddyfile в этой папке) на любой такой адрес
 * отдаёт index.html, дальше маршрут разбирает React Router. */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
