/* Компьютеры, с которых заходят в систему.

   Устройства появляются здесь сами, как только с них открыли систему.
   Администратор даёт им понятные имена — потом в профиле сотрудника можно
   указать, с каких рабочих мест разрешён вход. */

import { useState } from 'react';

import { deleteDevice, updateDevice, useDevices, useStaffMutation } from '@/api/staff';
import { useConfirm } from '@/app/ConfirmProvider';
import { useToast } from '@/app/ToastProvider';
import { DeviceIcon, EditIcon, TrashIcon } from '@/components/Icons';
import { Empty, Loading } from '@/components/ui';
import { dtRu } from '@/lib/format';
import type { Device } from '@/types/api';

export function DevicesTab() {
  const askConfirm = useConfirm();
  const { toast, toastError } = useToast();
  const devices = useDevices();

  const [renaming, setRenaming] = useState<number | null>(null);
  const [name, setName] = useState('');

  const rename = useStaffMutation((args: { id: number; name: string }) =>
    updateDevice(args.id, args.name),
  );
  const forget = useStaffMutation((id: number) => deleteDevice(id));

  const saveName = async (device: Device) => {
    setRenaming(null);
    if (name.trim() === device.name) return;
    try {
      await rename.mutateAsync({ id: device.id, name: name.trim() });
      toast('Название сохранено');
    } catch (e) {
      toastError(e);
    }
  };

  const onForget = async (device: Device) => {
    const ok = await askConfirm({
      eyebrow: 'Устройства',
      title: 'Забыть компьютер?',
      text: (
        <>
          Устройство <b>{device.display_name}</b> будет удалено из списка.
        </>
      ),
      note:
        device.bound_to.length > 0
          ? `К нему привязаны профили: ${device.bound_to.join(', ')}. Они станут недоступны, пока вы не привяжете их заново.`
          : '',
      yes: 'Забыть',
      danger: true,
    });
    if (!ok) return;

    try {
      await forget.mutateAsync(device.id);
      toast('Устройство забыто');
    } catch (e) {
      toastError(e);
    }
  };

  if (devices.isLoading) return <Loading />;
  if (devices.isError) return <Empty>{(devices.error as Error).message}</Empty>;

  const list = devices.data ?? [];

  return (
    <>
      <p className="sub" style={{ marginBottom: 22 }}>
        Компьютеры, с которых открывали систему. Дайте им понятные имена — потом в профиле
        сотрудника можно указать, с каких рабочих мест разрешён вход. Ключ компьютера хранится в
        браузере: очистка данных сайта или другой браузер на том же компьютере считаются новым
        устройством.
      </p>

      {list.length === 0 ? (
        <Empty>Пока ни одного устройства</Empty>
      ) : (
        <div className="dv-list">
          {list.map((device) => (
            <div className={device.is_current ? 'dv-card current' : 'dv-card'} key={device.id}>
              <span className="dv-ic">
                <DeviceIcon />
              </span>
              <span className="dv-main">
                {renaming === device.id ? (
                  <input
                    type="text"
                    autoFocus
                    value={name}
                    placeholder="Например «Приёмка» или «Ноутбук в цехе»"
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => void saveName(device)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <b>
                    {device.display_name}
                    {device.is_current ? ' · этот компьютер' : ''}
                  </b>
                )}
                <span className="meta">
                  {device.browser} · {device.last_ip || 'адрес неизвестен'} · был{' '}
                  {dtRu(device.last_seen_at)}
                </span>
              </span>

              <span className="dv-bound">
                {device.bound_to.length > 0 ? (
                  device.bound_to.map((profile) => (
                    <span className="dv-tag" key={profile}>
                      {profile}
                    </span>
                  ))
                ) : (
                  <span className="dv-tag free">профили не привязаны</span>
                )}
              </span>

              <span className="st-actions">
                <button
                  className="pr-act"
                  type="button"
                  title="Переименовать"
                  onClick={() => {
                    setRenaming(device.id);
                    setName(device.name);
                  }}
                >
                  <EditIcon />
                </button>
                <button
                  className="pr-act del"
                  type="button"
                  title="Забыть устройство"
                  onClick={() => void onForget(device)}
                >
                  <TrashIcon />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
