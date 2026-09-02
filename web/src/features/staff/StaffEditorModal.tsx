/* Окно настройки профиля: имя, откуда можно входить, пароль, права. */

import { useState } from 'react';

import {
  createEmployee,
  updateEmployee,
  useDevices,
  usePermissionCatalog,
  useStaffMutation,
} from '@/api/staff';
import { ModalShell, useModalFrame, useUnsavedGuard } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { Empty, Field, Loading, Section } from '@/components/ui';
import type {
  AccessMode,
  Employee,
  EmployeePayload,
  Permission,
  PermissionCatalog,
} from '@/types/api';

/* Быстрые наборы прав под типовые роли в цехе. */
const PRESETS: Record<string, { title: string; hint: string; keys: Permission[] }> = {
  reception: {
    title: 'Приёмщик',
    hint: 'Принимает заказы, ведёт клиентов, цены видит',
    keys: [
      'orders.view', 'orders.create', 'orders.edit', 'orders.status',
      'orders.price.view', 'orders.price.edit', 'orders.estimate',
      'clients.view', 'clients.search', 'clients.history',
    ],
  },
  production: {
    title: 'Производство',
    hint: 'Двигает заказы по статусам, денег не видит',
    keys: ['orders.view', 'orders.status'],
  },
  senior: {
    title: 'Старший смены',
    hint: 'Всё по заказам плюс итоги и прайс на просмотр',
    keys: [
      'orders.view', 'orders.create', 'orders.edit', 'orders.status', 'orders.delete',
      'orders.price.view', 'orders.price.edit', 'orders.estimate', 'finance.totals',
      'clients.view', 'clients.search', 'clients.history', 'prices.view',
    ],
  },
  none: { title: 'Снять все', hint: '', keys: [] },
};

export function StaffEditorModal({ employee }: { employee: Employee | null }) {
  const catalog = usePermissionCatalog();

  /* Ждём справочник прав, прежде чем показывать форму.
   *
   * У нового профиля набор галочек по умолчанию берётся из ответа сервера,
   * а начальное состояние React запоминает один раз при первом отрисовке.
   * Открой мы форму раньше ответа — новый сотрудник завёлся бы вообще без
   * прав, и понять почему было бы нечем. */
  if (!catalog.data) {
    return (
      <ModalShell eyebrow="Сотрудники" title={employee ? employee.name : 'Сотрудник'}>
        {catalog.isError ? (
          <Empty>{(catalog.error as Error).message}</Empty>
        ) : (
          <Loading>Загружаю список прав…</Loading>
        )}
      </ModalShell>
    );
  }

  return <StaffEditor employee={employee} catalog={catalog.data} />;
}

function StaffEditor({
  employee,
  catalog,
}: {
  employee: Employee | null;
  catalog: PermissionCatalog;
}) {
  const frame = useModalFrame();
  const { toast, toastError } = useToast();
  const devices = useDevices();

  const isNew = !employee;
  const save = useStaffMutation((payload: EmployeePayload) =>
    isNew ? createEmployee(payload) : updateEmployee(employee.id, payload),
  );

  const [name, setName] = useState(employee?.name ?? '');
  const [note, setNote] = useState(employee?.note ?? '');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<AccessMode>(employee?.access_mode ?? 'any');
  const [allowed, setAllowed] = useState<Set<number>>(new Set(employee?.allowed_devices ?? []));
  const [granted, setGranted] = useState<Set<Permission>>(
    new Set(employee?.permissions ?? catalog.defaults),
  );
  const [saving, setSaving] = useState(false);

  const snapshot = () =>
    JSON.stringify([name, note, password, mode, [...allowed].sort(), [...granted].sort()]);
  const [initialJson] = useState(snapshot);
  const markClean = useUnsavedGuard(snapshot() !== initialJson);

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const submit = async () => {
    if (!name.trim()) {
      toast('Укажите имя сотрудника');
      return;
    }
    if (mode === 'devices' && allowed.size === 0) {
      toast('Выберите хотя бы один компьютер — иначе в профиль не войти');
      return;
    }

    const payload: EmployeePayload = {
      name: name.trim(),
      note: note.trim(),
      permissions: [...granted],
      access_mode: mode,
      allowed_devices: [...allowed],
    };

    /* Пароль: у нового профиля отправляем как есть (пусто = без пароля).
     * У существующего пустое поле означает «оставить прежний», а минус —
     * явное снятие: посмотреть текущий пароль нельзя, только заменить. */
    if (isNew) payload.password = password;
    else if (password === '-') payload.password = '';
    else if (password) payload.password = password;

    setSaving(true);
    try {
      await save.mutateAsync(payload);
      toast(isNew ? `Профиль «${payload.name}» создан` : 'Сохранено');
      markClean();
      frame.close();
    } catch (e) {
      toastError(e);
      setSaving(false);
    }
  };

  return (
    <ModalShell
      eyebrow={isNew ? 'Новый профиль' : `Настройка · ${employee.name}`}
      title={isNew ? 'Сотрудник' : employee.name}
      foot={
        <>
          <button className="btn btn-ghost" type="button" onClick={frame.close}>
            Отмена
          </button>
          <div className="spacer" />
          <button className="btn btn-green" type="button" disabled={saving} onClick={submit}>
            {isNew ? 'Создать профиль' : 'Сохранить'}
          </button>
        </>
      }
    >
      <Section title="Профиль">
        <div className="grid">
          <Field label="Имя сотрудника">
            <input
              type="text"
              value={name}
              placeholder="Как показывать на входе"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Описание">
            <input
              type="text"
              value={note}
              placeholder="Например: приём заказов"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Откуда можно входить">
        <div className="mode-row">
          <button
            className={mode === 'any' ? 'mode-btn on' : 'mode-btn'}
            type="button"
            onClick={() => setMode('any')}
          >
            <b>С любого компьютера</b>
            <span>Профиль виден на всех рабочих местах.</span>
          </button>
          <button
            className={mode === 'devices' ? 'mode-btn on' : 'mode-btn'}
            type="button"
            onClick={() => setMode('devices')}
          >
            <b>Только с выбранных</b>
            <span>С других компьютеров профиль не появится в списке.</span>
          </button>
        </div>

        {mode === 'devices' && (
          <div className="dev-pick">
            {(devices.data ?? []).length === 0 ? (
              <div className="mx-empty">
                Устройств пока нет. Откройте систему на нужном компьютере — он появится в списке.
              </div>
            ) : (
              (devices.data ?? []).map((device) => (
                <label className={device.is_current ? 'dev-opt now' : 'dev-opt'} key={device.id}>
                  <input
                    type="checkbox"
                    checked={allowed.has(device.id)}
                    onChange={() => setAllowed((prev) => toggle(prev, device.id))}
                  />
                  <span className="txt">
                    <b>{device.display_name}</b>
                    <span>
                      {device.browser} · {device.last_ip || 'адрес неизвестен'}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        )}

        <div className="hint" style={{ marginTop: 10 }}>
          Компьютер запоминается по ключу в браузере. Очистка данных сайта или другой браузер на том
          же компьютере = новое устройство, привязку нужно обновить.
        </div>
      </Section>

      <Section
        title={
          <>
            Пароль <span style={{ color: 'var(--muted)', fontWeight: 400 }}>— необязательно</span>
          </>
        }
      >
        <Field
          hint={
            isNew
              ? 'Второй рубеж поверх привязки к компьютеру. Если рабочее место используют несколько человек — пароль стоит задать.'
              : employee.has_password
                ? 'Текущий пароль посмотреть нельзя, только задать новый. Чтобы убрать пароль — впишите минус.'
                : 'Сейчас профиль без пароля.'
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder={isNew ? 'Пусто — вход без пароля' : 'Пусто — оставить прежний'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Быстрый набор прав">
        <div className="perm-presets">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              type="button"
              key={key}
              title={preset.hint}
              onClick={() => setGranted(new Set(preset.keys))}
            >
              {preset.title}
            </button>
          ))}
        </div>
      </Section>

      {catalog.groups.map((group) => (
        <div className="perm-group" key={group.title}>
          <h4>
            <span className="reg">
              <i />
            </span>{' '}
            {group.title}
          </h4>
          {group.items.map((item) => (
            <label className={item.danger ? 'perm-row danger' : 'perm-row'} key={item.key}>
              <input
                type="checkbox"
                checked={granted.has(item.key)}
                onChange={() => setGranted((prev) => toggle(prev, item.key))}
              />
              <span className="txt">
                <b>{item.title}</b>
                <span>{item.hint}</span>
              </span>
            </label>
          ))}
        </div>
      ))}
    </ModalShell>
  );
}
