/* Раздел «Инструменты»: утилиты для цеха, не привязанные к заказу.
   Плитка показывается, если у профиля есть право на утилиту. План и
   границы — TODO.md, раздел 16. */

import { Link } from 'react-router-dom';

import { useAuth } from '@/app/AuthProvider';
import { Empty, PageHead } from '@/components/ui';

import { TOOLS } from './tools';
import { ToolsNotice } from './ToolsNotice';

export function ToolsPage() {
  const { can } = useAuth();
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
            {tools.map((tool) => (
              <Link className="tool-tile" to={tool.path} key={tool.key}>
                <b>{tool.title}</b>
                <span>{tool.hint}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
