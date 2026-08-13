/* Первый шаг создания заказа: какой это вид работ. */

import { useCatalog } from '@/api/catalog';
import { ModalShell } from '@/app/ModalProvider';
import { ArrowIcon, TemplateIcon } from '@/components/Icons';
import { Empty, Loading } from '@/components/ui';

import { useOpenNewOrderForm } from './useOpenOrderForm';

export function TemplatePickerModal() {
  const catalog = useCatalog();
  const openForm = useOpenNewOrderForm();

  const templates = catalog.data?.templates ?? [];

  return (
    <ModalShell eyebrow="Новый заказ" title="Вид работ">
      {catalog.isLoading && <Loading />}
      {catalog.isError && <Empty>Не удалось загрузить виды работ. Обновите страницу.</Empty>}
      {catalog.isSuccess && templates.length === 0 && (
        <Empty>
          Виды работ ещё не настроены. Их заводит администратор в разделе «Виды работ».
        </Empty>
      )}

      {templates.length > 0 && (
        <div className="tpl-list">
          {templates.map((template) => (
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
