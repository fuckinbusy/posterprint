import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* Стили лежат рядом с прежним фронтом и намеренно не скопированы сюда:
 * пока старый интерфейс остаётся запасным вариантом, две копии CSS
 * разъехались бы при первой же правке. */
import '../../static/css/app.css';

import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
