/* Страница профиля — по нажатию на имя в шапке.

   Раньше нажатие сразу спрашивало «сменить профиль?». Теперь здесь всё
   личное: кто вошёл и с какого устройства, что разрешено, настройки
   этого рабочего места (автообновление доски) и кнопки — сменить
   профиль, открыть кассу, перечитать данные. */

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchMe, fetchPermissionGroups } from '@/api/auth';
import { useAuth } from '@/app/AuthProvider';
import { useConfirm } from '@/app/ConfirmProvider';
import { useModal } from '@/app/ModalProvider';
import { BOARD_REFRESH, BOARD_REFRESH_LABEL, usePref, type BoardRefresh } from '@/app/prefs';
import { useToast } from '@/app/ToastProvider';
import { Select } from '@/components/Select';
import { Field, KeyValue, PageHead, Section } from '@/components/ui';
import { CashModal } from '@/features/cash/CashModal';

const KIND_LABEL = { admin: 'Администратор', employee: 'Сотрудник' } as const;

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

  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 60 * 1000 });
  const catalog = useQuery({
    queryKey: ['permission-groups'],
    queryFn: fetchPermissionGroups,
    staleTime: Infinity,
  });

  const [refresh, setRefresh] = usePref<BoardRefresh>('board.refresh', '0', BOARD_REFRESH);

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
                me.data?.device_name || (me.isLoading ? '…' : 'не зарегистрировано — вход с любого компьютера'),
              ],
              ['Сервер', window.location.host],
            ]}
          />
        </Section>

        <Section title="Доска">
          <Field
            label="Обновлять доску самой"
            hint={`Хранится в этом браузере для профиля «${session.name}». Планшету в цехе — включить: новые заказы появятся, даже если экран никто не трогает. За стойкой обычно не нужно: доска и так перечитывается при возврате в окно и после каждого сохранения.`}
          >
            <Select
              value={refresh}
              options={BOARD_REFRESH.map((v) => ({ value: v, label: BOARD_REFRESH_LABEL[v] }))}
              onChange={(v) => setRefresh(v as BoardRefresh)}
              aria-label="Автообновление доски"
            />
          </Field>
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
