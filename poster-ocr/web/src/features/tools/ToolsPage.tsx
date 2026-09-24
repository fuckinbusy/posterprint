/* Раздел «Инструменты»: утилиты для цеха, не привязанные к заказу, —
   просмотр макета, раскладка под печать, конструктор для ЧПУ, калькулятор.

   Пока пустой: что и в каком порядке делаем, расписано в TODO.md, раздел 16. */

import { Empty, PageHead } from '@/components/ui';

export function ToolsPage() {
  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Цех"
          title="Инструменты"
          sub="Утилиты для работы с макетами и расчётов, которые не привязаны к конкретному заказу."
        />
        <Empty>Скоро здесь будут утилиты.</Empty>
      </div>
    </main>
  );
}
