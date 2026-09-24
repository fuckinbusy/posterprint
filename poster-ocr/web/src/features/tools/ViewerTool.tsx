/* 16.1: просмотр любого .cdr без заказа. Файл уходит на сервер только на
   время разбора; окно просмотра — то же, что у макета заказа. */

import { useState } from 'react';

import { PageHead } from '@/components/ui';
import { DesignViewer } from '@/features/design/DesignViewer';

import { FileDrop } from './FileDrop';

export function ViewerTool() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Инструменты"
          title="Просмотр макета"
          sub="Содержимое .cdr любой версии: размеры объектов в мм, шрифты, растры. На сервере файл не остаётся."
        />
        <FileDrop accept=".cdr" hint="Перетащите сюда файл .cdr или выберите его" onFile={setFile} />
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
