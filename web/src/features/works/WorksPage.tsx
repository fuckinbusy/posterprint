/* Раздел «Виды работ»: список того, что сотрудник выбирает первым шагом. */

import { useDeleteTemplate, useTemplateMeta, useTemplates } from '@/api/templates';
import { useCan } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { EditIcon, EyeIcon, EyeOffIcon, TemplateIcon, TrashIcon } from '@/components/Icons';
import { Empty, Loading, PageHead } from '@/components/ui';
import { plural } from '@/lib/format';
import type { WorkFieldOut, WorkTemplate } from '@/types/api';

import { WorkEditorModal, toPayload } from './WorkEditorModal';
import { useSaveTemplate } from '@/api/templates';

export function WorksPage() {
  const can = useCan();
  const modal = useModal();
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();

  const templates = useTemplates();
  const meta = useTemplateMeta();
  const saveTemplate = useSaveTemplate();
  const deleteTemplate = useDeleteTemplate();

  const editable = can('prices.edit');
  const roleTitle = (key: string) =>
    meta.data?.roles.find((r) => r.key === key)?.title ?? key;

  /* Подпись поля в плитке. У измерений дописываем единицу самого поля:
     раньше название роли жёстко говорило «Ширина, мм», а поле могло быть
     заведено в метрах — плитка врала. */
  const fieldNote = (field: WorkFieldOut): string => {
    if (field.pricing_role === 'none') return '';
    const title = roleTitle(field.pricing_role);
    const isSize = ['width', 'height', 'length'].includes(field.pricing_role);
    return isSize && field.unit ? `${title}, ${field.unit}` : title;
  };

  const toggleActive = async (template: WorkTemplate) => {
    try {
      await saveTemplate.mutateAsync({
        id: template.id,
        payload: { ...toPayload(template), active: !template.active },
      });
      toast(template.active ? `«${template.title}» скрыт` : `«${template.title}» снова доступен`);
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async (template: WorkTemplate) => {
    const ok = await askConfirm({
      eyebrow: 'Виды работ',
      title: 'Удалить вид работ?',
      text: (
        <>
          <b>{template.title}</b> исчезнет из списка при создании заказа.
        </>
      ),
      note: template.orders_count
        ? `По нему уже есть заказы (${template.orders_count}) — удалить не получится, можно только скрыть.`
        : 'Ненужный вид работ можно скрыть — тогда он останется в настройках.',
      yes: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    try {
      await deleteTemplate.mutateAsync(template.id);
      toast('Вид работ удалён');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Настройки"
          title="Виды работ"
          sub="То, что сотрудник выбирает первым шагом при создании заказа. У каждого вида свой набор полей: списки материалов подтягиваются из разделов прайса, а роль поля определяет, как оно влияет на цену. Формулы писать не нужно."
          actions={
            editable && (
              <button
                className="btn btn-green"
                type="button"
                onClick={() => modal.open(<WorkEditorModal template={null} />)}
              >
                + Новый вид работ
              </button>
            )
          }
        />

        {templates.isLoading && <Loading />}
        {templates.isError && <Empty>{(templates.error as Error).message}</Empty>}

        <div className="st-list">
          {(templates.data ?? []).map((template) => (
            <div className={template.active ? 'st-card' : 'st-card off'} key={template.id}>
              <div className="st-top">
                <span className="st-av">
                  <TemplateIcon name={template.icon} />
                </span>
                <span className="st-name">
                  <b>{template.title}</b>
                  <span>
                    {template.hint || 'без описания'} · {template.orders_count}{' '}
                    {plural(template.orders_count, 'заказ', 'заказа', 'заказов')}
                  </span>
                </span>
                <span className="st-badge">
                  {template.fields.length} {plural(template.fields.length, 'поле', 'поля', 'полей')}
                </span>
                {!template.active && <span className="st-badge warn">скрыт</span>}
                {editable && (
                  <span className="st-actions">
                    <button
                      className="pr-act"
                      type="button"
                      title="Настроить"
                      onClick={() => modal.open(<WorkEditorModal template={template} />)}
                    >
                      <EditIcon />
                    </button>
                    <button
                      className="pr-act"
                      type="button"
                      title={template.active ? 'Скрыть' : 'Показать'}
                      onClick={() => void toggleActive(template)}
                    >
                      {template.active ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                    {/* По виду с заказами сервер удалять откажет — незачем
                        предлагать кнопку, которая заведомо кончится ошибкой.
                        Остаётся «скрыть». */}
                    {template.orders_count === 0 && (
                      <button
                        className="pr-act del"
                        type="button"
                        title="Удалить"
                        onClick={() => void remove(template)}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div className="st-perms">
                {template.fields.length === 0 ? (
                  <span className="st-none">Полей нет</span>
                ) : (
                  template.fields.map((field) => (
                    <span
                      className={field.pricing_role !== 'none' ? 'st-perm' : 'st-perm muted'}
                      key={field.id}
                    >
                      {field.label}
                      {fieldNote(field) ? ` · ${fieldNote(field)}` : ''}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
