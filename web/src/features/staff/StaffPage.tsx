/* Раздел «Сотрудники»: профили и устройства двумя вкладками. */

import { useState } from 'react';

import {
  deleteEmployee,
  updateEmployee,
  useDevices,
  useEmployees,
  usePermissionCatalog,
  useStaffMutation,
} from '@/api/staff';
import { useConfirm } from '@/app/ConfirmProvider';
import { useModal } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { EditIcon, EyeIcon, EyeOffIcon, TrashIcon } from '@/components/Icons';
import { Empty, Loading, PageHead } from '@/components/ui';
import { dtRu, initials, plural } from '@/lib/format';
import type { Employee } from '@/types/api';

import { DevicesTab } from './DevicesTab';
import { StaffEditorModal } from './StaffEditorModal';

type Tab = 'people' | 'devices';

export function StaffPage() {
  const [tab, setTab] = useState<Tab>('people');

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead eyebrow="Настройки" title={tab === 'devices' ? 'Устройства' : 'Сотрудники'} />

        <div className="mx-tabs">
          <button className={tab === 'people' ? 'active' : ''} type="button" onClick={() => setTab('people')}>
            Профили
          </button>
          <button
            className={tab === 'devices' ? 'active' : ''}
            type="button"
            onClick={() => setTab('devices')}
          >
            Устройства
          </button>
        </div>

        {tab === 'devices' ? <DevicesTab /> : <PeopleTab />}
      </div>
    </main>
  );
}

function PeopleTab() {
  const modal = useModal();
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();

  const employees = useEmployees();
  const permissions = usePermissionCatalog();
  const devices = useDevices();

  const toggleActive = useStaffMutation((employee: Employee) =>
    updateEmployee(employee.id, { active: !employee.active }),
  );
  const removeEmployee = useStaffMutation((id: number) => deleteEmployee(id));

  const permissionTitle = (key: string) => {
    for (const group of permissions.data?.groups ?? []) {
      const found = group.items.find((item) => item.key === key);
      if (found) return found;
    }
    return null;
  };

  const deviceName = (id: number) =>
    devices.data?.find((d) => d.id === id)?.display_name ?? `устройство #${id}`;

  const onToggle = async (employee: Employee) => {
    try {
      await toggleActive.mutateAsync(employee);
      toast(employee.active ? `${employee.name} отключён` : `${employee.name} снова активен`);
    } catch (e) {
      toastError(e);
    }
  };

  const onDelete = async (employee: Employee) => {
    const ok = await askConfirm({
      eyebrow: 'Сотрудники',
      title: 'Удалить профиль?',
      text: [
        <>
          Профиль <b>{employee.name}</b> будет удалён без возможности вернуть.
        </>,
        'Заказы, которые он принял, останутся — имя в них хранится текстом.',
      ],
      note: 'Если сотрудник ушёл временно, профиль лучше отключить, а не удалять.',
      yes: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    try {
      await removeEmployee.mutateAsync(employee.id);
      toast('Профиль удалён');
    } catch (e) {
      toastError(e);
    }
  };

  if (employees.isLoading || permissions.isLoading) return <Loading />;
  if (employees.isError) return <Empty>{(employees.error as Error).message}</Empty>;

  return (
    <>
      <p className="sub" style={{ marginBottom: 18 }}>
        У каждого профиля своё имя, права и список компьютеров, с которых в него можно войти. Права
        и привязка проверяются на сервере — изменения действуют сразу, перезаходить не нужно.
      </p>

      <div className="page-actions" style={{ marginBottom: 22 }}>
        <button
          className="btn btn-green"
          type="button"
          onClick={() => modal.open(<StaffEditorModal employee={null} />)}
        >
          + Новый профиль
        </button>
      </div>

      {(employees.data ?? []).length === 0 && (
        <Empty>
          Профилей пока нет. Пока их не завели, все работают под администратором —
          и любое действие в истории заказов подписано «Администратор». Заведите
          профиль на каждого, кто принимает заказы: тогда видно, кто что сделал.
        </Empty>
      )}

      <div className="st-list">
        {(employees.data ?? []).map((employee) => {
          const perms = employee.permissions.map(permissionTitle).filter(Boolean);
          return (
            <div className={employee.active ? 'st-card' : 'st-card off'} key={employee.id}>
              <div className="st-top">
                <span className="st-av">{initials(employee.name)}</span>
                <span className="st-name">
                  <b>{employee.name}</b>
                  <span>
                    {employee.note || 'без описания'}
                    {employee.last_login_at
                      ? ` · заходил ${dtRu(employee.last_login_at)}`
                      : ' · ещё не заходил'}
                  </span>
                </span>

                <span className={employee.access_mode === 'devices' ? 'st-badge on' : 'st-badge'}>
                  {employee.access_mode === 'devices'
                    ? employee.allowed_devices.length > 0
                      ? employee.allowed_devices.map(deviceName).join(', ')
                      : 'привязан, но устройств нет'
                    : 'с любого компьютера'}
                </span>
                {employee.has_password && <span className="st-badge on">пароль</span>}
                <span className="st-badge">
                  {employee.permissions.length}{' '}
                  {plural(employee.permissions.length, 'право', 'права', 'прав')}
                </span>
                {!employee.active && <span className="st-badge warn">отключён</span>}

                <span className="st-actions">
                  <button
                    className="pr-act"
                    type="button"
                    title="Настроить"
                    onClick={() => modal.open(<StaffEditorModal employee={employee} />)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    className="pr-act"
                    type="button"
                    title={employee.active ? 'Отключить' : 'Включить'}
                    onClick={() => void onToggle(employee)}
                  >
                    {employee.active ? <EyeIcon /> : <EyeOffIcon />}
                  </button>
                  <button
                    className="pr-act del"
                    type="button"
                    title="Удалить"
                    onClick={() => void onDelete(employee)}
                  >
                    <TrashIcon />
                  </button>
                </span>
              </div>

              <div className="st-perms">
                {perms.length === 0 ? (
                  <span className="st-none">Прав нет — сотрудник не увидит ничего</span>
                ) : (
                  perms.map((perm) => (
                    <span className={perm?.danger ? 'st-perm danger' : 'st-perm'} key={perm?.key}>
                      {perm?.title}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
