/* Раскладка приложения: шапка, полоса фильтров и текущий раздел.

   Здесь же живёт состояние доски — поиск, фильтр по виду работ и порядок
   карточек. Оно нужно сразу трём местам (поиск в шапке, полоса фильтров,
   сама доска), поэтому держится на уровне раскладки и передаётся вниз
   свойствами: контекст ради трёх значений был бы лишним слоем. */

import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useCatalog } from '@/api/catalog';
import { BoardPage } from '@/features/board/BoardPage';
import { BoardFilters } from '@/features/board/BoardFilters';
import { BOARD_SORTS, type BoardSort } from '@/features/board/sorting';
import { ClientsPage } from '@/features/clients/ClientsPage';
import { GateScreen } from '@/features/gate/GateScreen';
import { LogsPage } from '@/features/logs/LogsPage';
import { MetricsPage } from '@/features/metrics/MetricsPage';
import { PricesPage } from '@/features/prices/PricesPage';
import { StaffPage } from '@/features/staff/StaffPage';
import { TopBar } from '@/features/shell/TopBar';
import { WorksPage } from '@/features/works/WorksPage';
import type { Permission } from '@/types/api';

import { useAuth, useCan } from './AuthProvider';
import { viewByPath } from './views';

const SORT_STORAGE = 'poster.sort';

/** Выбранный порядок переживает перезагрузку: за доской работают целый день,
 *  и заново выставлять его каждое утро — лишнее раздражение. */
function readSort(): BoardSort {
  const saved = localStorage.getItem(SORT_STORAGE);
  return BOARD_SORTS.includes(saved as BoardSort) ? (saved as BoardSort) : 'due';
}

export function Shell() {
  const { session, checking } = useAuth();
  const location = useLocation();

  /* состояние доски */
  const [query, setQuery] = useState('');
  const [templateKey, setTemplateKey] = useState('all');
  const [sort, setSort] = useState<BoardSort>(readSort);

  const catalog = useCatalog(Boolean(session));

  const onBoard = location.pathname === '/board' || location.pathname === '/';
  /* Один фильтр на доску и на счётчик в шапке: ключ кэша совпадает,
   * поэтому запрос уходит один, а данные видят оба. */
  const filter = { q: query, templateKey };

  useEffect(() => {
    const view = viewByPath(location.pathname);
    document.title = view ? view.title : 'ПОСТЕР · Заказы';
  }, [location.pathname]);

  const changeSort = (value: BoardSort) => {
    setSort(value);
    localStorage.setItem(SORT_STORAGE, value);
  };

  // пока проверяется сохранённый токен, не показываем ни доску, ни экран
  // входа: иначе на секунду мелькает «кто работает?» у уже вошедшего
  if (checking) return null;
  if (!session) return <GateScreen />;

  return (
    <>
      <TopBar filter={filter} query={query} onQueryChange={setQuery} showSearch={onBoard} />

      {onBoard && (
        <BoardFilters
          templates={catalog.data?.templates ?? []}
          templateKey={templateKey}
          onTemplateChange={setTemplateKey}
          sort={sort}
          onSortChange={changeSort}
        />
      )}

      <Routes>
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route path="/board" element={<BoardPage filter={filter} sort={sort} />} />
        <Route
          path="/clients"
          element={
            <Guarded permission="clients.list">
              <ClientsPage />
            </Guarded>
          }
        />
        <Route
          path="/prices"
          element={
            <Guarded permission="prices.view">
              <PricesPage />
            </Guarded>
          }
        />
        <Route
          path="/works"
          element={
            <Guarded permission="prices.view">
              <WorksPage />
            </Guarded>
          }
        />
        <Route
          path="/staff"
          element={
            <Guarded permission="staff.manage">
              <StaffPage />
            </Guarded>
          }
        />
        <Route
          path="/metrics"
          element={
            <Guarded permission="metrics.view">
              <MetricsPage />
            </Guarded>
          }
        />
        <Route
          path="/logs"
          element={
            <Guarded permission="staff.manage">
              <LogsPage />
            </Guarded>
          }
        />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Routes>
    </>
  );
}

/** Раздел, закрытый правом. Если права нет — молча уводим на доску.
 *
 *  Это подстраховка, а не защита: вкладку раздела и так не показывают без
 *  права, но адрес можно набрать руками или прийти по старой ссылке. Данные
 *  всё равно закрыты на сервере — здесь мы избавляем человека от пустой
 *  страницы с ошибкой. */
function Guarded({ permission, children }: { permission: Permission; children: ReactNode }) {
  const can = useCan();
  if (!can(permission)) return <Navigate to="/board" replace />;
  return <>{children}</>;
}
