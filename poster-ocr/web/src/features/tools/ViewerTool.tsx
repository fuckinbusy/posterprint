/* 16.1: просмотр любого .cdr без заказа. Файл уходит на сервер только на
   время разбора; окно просмотра — то же, что у макета заказа. Предел
   размера — как у макета заказа (services/tool_files.MAX_VIEW_BYTES). */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { PageHead } from '@/components/ui';
import { DesignViewer } from '@/features/design/DesignViewer';

import { FileDrop } from './FileDrop';
import { ToolsNotice } from './ToolsNotice';

const MAX_VIEW_BYTES = 300 * 1024 * 1024;

export function ViewerTool() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <Link className="page-back" to="/tools">
          ← Все инструменты
        </Link>
        <PageHead
          eyebrow="Инструменты"
          title="Просмотр макета"
          sub="Содержимое .cdr любой версии: размеры объектов в мм, шрифты, растры. На сервере файл не остаётся."
        />
        <ToolsNotice />
        <FileDrop
          accept=".cdr"
          hint="Перетащите сюда файл .cdr или выберите его"
          maxBytes={MAX_VIEW_BYTES}
          onFile={setFile}
        />
      </div>
      {file && (
        <DesignViewer
          source={{ kind: 'file', file }}
          title={file.name}
          thumbnail={null}
          onClose={() => setFile(null)}
        />
      )}
    </main>
  );
}
