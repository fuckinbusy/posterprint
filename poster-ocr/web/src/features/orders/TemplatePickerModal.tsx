/* Первый шаг создания заказа: какой это вид работ. */

import { useState } from 'react';

import { useCatalog } from '@/api/catalog';
import { ModalShell } from '@/app/ModalProvider';
import { ArrowIcon, TemplateIcon } from '@/components/Icons';
import { Empty, Loading } from '@/components/ui';

import { useOpenNewOrderForm } from './useOpenOrderForm';

/* С какого числа видов работ показывать поиск. При четырёх-пяти плитках он
   только занимает место, при десяти — без него листают. */
const SEARCH_FROM = 6;

/** onPick — что делать с выбранным видом. Без него открывается форма
 *  нового заказа; с ним — форма существующего меняет вид работ. */
export function TemplatePickerModal({ onPick }: { onPick?: (key: string) => void } = {}) {
  const catalog = useCatalog();
  const openNew = useOpenNewOrderForm();
  const openForm = onPick ?? openNew;
  const [query, setQuery] = useState('');

  const templates = catalog.data?.templates ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? templates.filter(
        (t) => t.title.toLowerCase().includes(needle) || t.hint.toLowerCase().includes(needle),
      )
    : templates;

  return (
    <ModalShell eyebrow="Новый заказ" title="Вид работ">
      {catalog.isLoading && <Loading />}
      {catalog.isError && <Empty>Не удалось загрузить виды работ. Обновите страницу.</Empty>}
      {catalog.isSuccess && templates.length === 0 && (
        <Empty>
          Виды работ ещё не настроены. Их заводит администратор в разделе «Виды работ».
        </Empty>
      )}

      {templates.length >= SEARCH_FROM && (
        <div className="field" style={{ marginBottom: 14 }}>
          <input
            type="search"
            autoFocus
            placeholder="Найти вид работ…"
            aria-label="Поиск по видам работ"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter по единственному совпадению — сразу в форму
              if (e.key === 'Enter' && shown.length === 1) openForm(shown[0].key);
            }}
          />
        </div>
      )}

      {templates.length > 0 && shown.length === 0 && (
        <Empty>По запросу «{query}» ничего нет</Empty>
      )}

      {shown.length > 0 && (
        <div className="tpl-list">
          {shown.map((template) => (
            <button
              className="tpl"
              type="button"
              key={template.key}
              onClick={() => openForm(template.key)}
            >
              <span className="ic">
                <TemplateIcon name={template.icon} />
              </span>
              <span className="txt">
                <b>{template.title}</b>
                <span>{template.hint}</span>
              </span>
              <span className="go">
                <ArrowIcon />
              </span>
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
