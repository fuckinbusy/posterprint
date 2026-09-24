/* API-ключ сотрудника в окне профиля — только для администратора.
 *
 * Ключ — пропуск для ботов и программ: запрос с заголовком X-API-Key
 * работает от имени сотрудника и с его правами. По умолчанию он скрыт:
 * сервер записывает каждый показ в журнал, поэтому ключ запрашиваем только
 * по кнопке, а не вместе с профилем. */

import { useState } from 'react';

import { fetchApiKey, rotateApiKey } from '@/api/staff';
import { useConfirm } from '@/app/ConfirmProvider';
import { useToast } from '@/app/ToastProvider';
import { Section } from '@/components/ui';
import { copyText } from '@/lib/clipboard';

const HIDDEN = 'pst_' + '•'.repeat(24);

export function ApiKeySection({ employeeId, name }: { employeeId: number; name: string }) {
  const { toast, toastError } = useToast();
  const askConfirm = useConfirm();
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  // ключ берём с сервера один раз; дальше «Скрыть»/«Показать» — без запроса
  const load = async (): Promise<string | null> => {
    if (key) return key;
    setBusy(true);
    try {
      const { api_key } = await fetchApiKey(employeeId);
      setKey(api_key);
      return api_key;
    } catch (e) {
      toastError(e);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggleShown = async () => {
    if (shown) {
      setShown(false);
      return;
    }
    if (await load()) setShown(true);
  };

  const copy = async () => {
    const value = await load();
    if (!value) return;
    toast((await copyText(value)) ? 'Ключ скопирован' : 'Не удалось скопировать — выделите ключ вручную');
  };

  const rotate = async () => {
    const ok = await askConfirm({
      eyebrow: 'API-ключ',
      title: 'Перевыпустить ключ?',
      text: [
        <>
          Текущий ключ профиля <b>{name}</b> перестанет работать сразу.
        </>,
        'Боты и программы, которые им пользуются, остановятся, пока в них не впишут новый.',
      ],
      yes: 'Перевыпустить',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { api_key } = await rotateApiKey(employeeId);
      setKey(api_key);
      setShown(true);
      toast('Выпущен новый ключ — старый больше не работает');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="API-ключ">
      <div className="api-key-row">
        <code className="api-key-value">{shown && key ? key : HIDDEN}</code>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={toggleShown}>
          {shown ? 'Скрыть' : 'Показать'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={copy}>
          Копировать
        </button>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={rotate}>
          Перевыпустить
        </button>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Пропуск для ботов и программ: запрос с заголовком <code>X-API-Key</code> работает от имени этого
        сотрудника и с его правами, с любого компьютера. Держите ключ в секрете, как пароль. Утёк или бот
        больше не нужен — перевыпустите.
      </div>
    </Section>
  );
}
