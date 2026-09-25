/* Раздел «Инструменты»: утилиты для цеха, не привязанные к заказу.
   Плитка показывается, если у профиля есть право на утилиту. Утилита, которая
   на этом сервере не работает (нет разборщика .cdr), остаётся на месте, но
   серая, без перехода и с плашкой «В разработке» — и причиной под ней. */

import { Link } from 'react-router-dom';

import { useAuth } from '@/app/AuthProvider';
import { Empty, PageHead } from '@/components/ui';

import { TOOLS } from './tools';
import { ToolsNotice } from './ToolsNotice';
import { useAvailability } from './useAvailability';

export function ToolsPage() {
  const { can } = useAuth();
  const availability = useAvailability();
  const tools = TOOLS.filter((tool) => can(tool.permission));
  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Цех"
          title="Инструменты"
          sub="Утилиты для работы с макетами. Файлы на сервере не сохраняются: открыли, поработали, ушли."
        />
        <ToolsNotice />
        {tools.length === 0 ? (
          <Empty>Для вашего профиля утилит нет — права выдаёт администратор.</Empty>
        ) : (
          <div className="tool-grid">
            {tools.map((tool) => {
              const state = availability.get(tool.key);
              if (!state.available) {
                return (
                  <div className="tool-tile off" key={tool.key} aria-disabled="true" title={state.reason}>
                    <div className="tool-tile-head">
                      <b>{tool.title}</b>
                      <span className="tool-badge">В разработке</span>
                    </div>
                    <span>{tool.hint}</span>
                  </div>
                );
              }
              return (
                <Link className="tool-tile" to={tool.path} key={tool.key}>
                  <b>{tool.title}</b>
                  <span>{tool.hint}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
