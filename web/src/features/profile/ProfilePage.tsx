/* Страница профиля — по нажатию на имя в шапке.

   Раньше нажатие сразу спрашивало «сменить профиль?». Теперь здесь всё
   личное: кто вошёл и с какого устройства, что разрешено, настройки
   этого рабочего места (автообновление доски) и кнопки — сменить
   профиль, открыть кассу, перечитать данные. */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { fetchMe, fetchPermissionGroups } from '@/api/auth';
import { useAuth } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { useModal } from '@/app/ModalProvider';
import { BOARD_REFRESH, BOARD_REFRESH_LABEL, usePref, type BoardRefresh } from '@/app/prefs';
import { setTheme, useTheme, type Theme } from '@/app/theme';
import { useToast } from '@/app/ToastProvider';
import { Select } from '@/components/Select';
import { Field, KeyValue, PageHead, Section } from '@/components/ui';
import { CashModal } from '@/features/cash/CashModal';
import {
  NOTIFY_SOUND,
  askSystemNotices,
  systemNoticesAllowed,
  systemNoticesPossible,
  type NotifySound,
} from '@/features/notify/OrderNotices';
import { pushNotice } from '@/features/notify/notices';
import { todayISO } from '@/lib/format';
import type { Order } from '@/types/api';

const KIND_LABEL = { admin: 'Администратор', employee: 'Сотрудник' } as const;

const SOUND_LABEL: Record<NotifySound, string> = {
  on: 'Со звуком',
  off: 'Без звука',
};

/** Заказ для кнопки «Проверить»: показать, как выглядит уведомление. */
const sampleOrder = (): Order =>
  ({
    id: 0,
    number: 'ЗК-ПРОВЕРКА',
    template_key: 'banner_print',
    status: 'new',
    title: 'Баннер 3 × 1 м на фасад',
    client_name: 'Автосервис «Гарант»',
    client_phone: '',
    quantity: 1,
    params: {},
    price: 1180,
    prepaid: 0,
    due_date: todayISO(),
    manager: 'Аня',
  }) as unknown as Order;

const HOTKEYS: [string, string][] = [
  ['/', 'поиск на доске'],
  ['Enter', 'открыть выбранную карточку'],
  ['Правая кнопка', 'меню карточки: статус, печать, удаление'],
  ['Esc', 'закрыть окно'],
  ['Долгое нажатие', 'на планшете — поднять карточку и перетащить'],
];

export function ProfilePage() {
  const { session, can, signOut } = useAuth();
  const askConfirm = useConfirm();
  const modal = useModal();
  const qc = useQueryClient();
  const { toast } = useToast();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    staleTime: 60 * 1000,
  });
  const catalog = useQuery({
    queryKey: ['permission-groups'],
    queryFn: fetchPermissionGroups,
    staleTime: Infinity,
  });

  const [refresh, setRefresh] = usePref<BoardRefresh>('board.refresh', '0', BOARD_REFRESH);
  const theme = useTheme();
  const [sound, setSound] = usePref<NotifySound>('notify.sound', 'on', NOTIFY_SOUND);
  const [systemAllowed, setSystemAllowed] = useState(systemNoticesAllowed());

  const allowSystem = async () => {
    const ok = await askSystemNotices();
    setSystemAllowed(ok);
    toast(
      ok ? 'Браузер будет показывать уведомления и в свёрнутой вкладке' : 'Браузер не разрешил уведомления',
    );
  };

  const changeProfile = async () => {
    const ok = await askConfirm({
      eyebrow: session?.name ?? '',
      title: 'Сменить профиль?',
      text: 'Вы вернётесь к экрану выбора. Несохранённые изменения в открытых окнах пропадут.',
      yes: 'Выйти',
      no: 'Остаться',
    });
    if (ok) signOut();
  };

  const reload = async () => {
    await qc.invalidateQueries();
    toast('Данные перечитаны с сервера');
  };

  if (!session) return null;
  const isAdmin = session.kind === 'admin';
  const groups = catalog.data?.groups ?? [];

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Профиль"
          title={session.name}
          sub={
            isAdmin
              ? 'Администратор: все права, вход с любого компьютера по паролю.'
              : 'Сотрудник. Что разрешено — ниже; менять права может тот, кто управляет сотрудниками.'
          }
          actions={
            <>
              {can('finance.cash') && (
                <button className="btn btn-ghost" type="button" onClick={() => modal.open(<CashModal />)}>
                  Касса за день
                </button>
              )}
              <button className="btn btn-ghost" type="button" onClick={() => void reload()}>
                Перечитать данные
              </button>
              <button className="btn btn-green" type="button" onClick={() => void changeProfile()}>
                Сменить профиль
              </button>
            </>
          }
        />

        <Section title="Это рабочее место">
          <KeyValue
            rows={[
              ['Профиль', KIND_LABEL[session.kind]],
              [
                'Устройство',
                me.data?.device_name ||
                  (me.isLoading ? '…' : 'не зарегистрировано — вход с любого компьютера'),
              ],
              ['Сервер', window.location.host],
            ]}
          />
        </Section>

        <Section title="Оформление">
          <Field
            label="Тема"
            hint="Хранится в этом браузере: тема — про экран и освещение в комнате, а не про профиль. Переключатель есть и в шапке, рядом с именем."
          >
            <Select
              value={theme}
              options={[
                { value: 'dark', label: 'Тёмная' },
                { value: 'light', label: 'Светлая' },
              ]}
              onChange={(v) => setTheme(v as Theme)}
              aria-label="Тема оформления"
            />
          </Field>
        </Section>

        <Section title="Доска">
          <Field
            label="Обновлять доску самой"
            hint={`Хранится в этом браузере для профиля «${session.name}». Планшету в цехе — включить: новые заказы появятся, даже если экран никто не трогает. За стойкой обычно не нужно: доска и так перечитывается при возврате в окно и после каждого сохранения.`}
          >
            <Select
              value={refresh}
              options={BOARD_REFRESH.map((v) => ({
                value: v,
                label: BOARD_REFRESH_LABEL[v],
              }))}
              onChange={(v) => setRefresh(v as BoardRefresh)}
              aria-label="Автообновление доски"
            />
          </Field>
        </Section>

        <Section title="Уведомления о новых заказах">
          {can('notify.orders') ? (
            <>
              <Field
                label="Когда кто-то другой оформил заказ"
                hint="Всплывающее окно справа сверху: номер, работа, клиент, срок. Висит 15 секунд, под курсором не исчезает. Звук — короткий сигнал; браузер разрешает его после первого нажатия на странице."
              >
                <Select
                  value={sound}
                  options={NOTIFY_SOUND.map((v) => ({
                    value: v,
                    label: SOUND_LABEL[v],
                  }))}
                  onChange={(v) => setSound(v as NotifySound)}
                  aria-label="Звук уведомлений"
                />
              </Field>
              <div className="profile-row">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => pushNotice(sampleOrder(), { test: true })}
                >
                  Проверить
                </button>
                {systemAllowed ? (
                  <span className="hint">
                    Уведомления браузера разрешены: в свёрнутой вкладке заказ покажет и система.
                  </span>
                ) : systemNoticesPossible() ? (
                  <button className="btn btn-ghost" type="button" onClick={() => void allowSystem()}>
                    Разрешить уведомления браузера
                  </button>
                ) : (
                  <span className="hint">Браузер запретил системные уведомления для этого сайта.</span>
                )}
              </div>
            </>
          ) : (
            <p className="hint">
              Для этого профиля уведомления выключены. Включает право «Получать уведомления о новых заказах»
              тот, кто управляет сотрудниками.
            </p>
          )}
        </Section>

        <Section title="Что разрешено">
          {isAdmin ? (
            <p className="hint">Администратору доступно всё, отдельные права не настраиваются.</p>
          ) : groups.length === 0 ? (
            <p className="hint">{catalog.isLoading ? 'Читаю…' : 'Справочник прав недоступен.'}</p>
          ) : (
            <div className="perm-groups">
              {groups.map((group) => {
                const granted = group.items.filter((item) => can(item.key));
                if (granted.length === 0) return null;
                return (
                  <div className="perm-group" key={group.title}>
                    <span className="perm-group-title">{group.title}</span>
                    <div className="perm-chips">
                      {granted.map((item) => (
                        <span className="perm-chip" key={item.key} title={item.hint}>
                          {item.title}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Быстрые клавиши">
          <KeyValue rows={HOTKEYS.map(([key, text]) => [<kbd key={key}>{key}</kbd>, text])} />
        </Section>
      </div>
    </main>
  );
}
