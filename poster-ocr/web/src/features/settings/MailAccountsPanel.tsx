/* Почтовые ящики мастерской: подключить, поправить, проверить, отключить.

   Ящиков несколько — общий для заказов, отдельный для бухгалтерии. Кто какой
   видит, выбирается в профиле сотрудника (не больше двух на человека);
   администратор видит все. Пароль сюда вводится один раз и обратно не
   показывается: на сервере он лежит зашифрованным. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  checkMailAccount,
  createMailAccount,
  deleteMailAccount,
  fetchMailAccounts,
  updateMailAccount,
  type MailAccount,
  type MailAccountPayload,
  type MailAccountsData,
  type MailCheck,
  type MailProvider,
} from '@/api/mail';
import { useConfirm } from '@/app/ConfirmProvider';
import { useToast } from '@/app/ToastProvider';
import { Select } from '@/components/Select';
import { Field } from '@/components/ui';

interface Draft {
  id: number | null;
  title: string;
  provider: string;
  user: string;
  password: string;
  imap: string;
  smtp: string;
  sender_name: string;
  active: boolean;
}

const EMPTY: Draft = {
  id: null,
  title: '',
  provider: '',
  user: '',
  password: '',
  imap: '',
  smtp: '',
  sender_name: '',
  active: true,
};

const MAILRU = ['mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'internet.ru', 'xmail.ru'];
const YANDEX = ['yandex.ru', 'yandex.com', 'ya.ru', 'yandex.by', 'yandex.kz'];

const noDot = (text: string): string => text.replace(/[.\s]+$/, '');

/** Служба по домену — чтобы серверы подставились, пока человек печатает адрес. */
export function guessProvider(address: string): string {
  const domain = address.split('@')[1]?.trim().toLowerCase() ?? '';
  if (!domain) return '';
  if (MAILRU.includes(domain)) return 'mailru';
  if (YANDEX.includes(domain)) return 'yandex';
  return 'custom';
}

export function MailAccountsPanel() {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const askConfirm = useConfirm();
  const accounts = useQuery({ queryKey: ['mail-accounts'], queryFn: fetchMailAccounts });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checks, setChecks] = useState<Record<number, MailCheck | 'busy'>>({});

  const accept = (data: MailAccountsData) => {
    qc.setQueryData(['mail-accounts'], data);
    // список ящиков и статус почты у всех открытых страниц устарели
    void qc.invalidateQueries({ queryKey: ['mail'] });
  };

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body: MailAccountPayload = {
        title: d.title.trim(),
        provider: d.provider || guessProvider(d.user),
        user: d.user.trim(),
        imap: d.imap.trim(),
        smtp: d.smtp.trim(),
        sender_name: d.sender_name.trim(),
        active: d.active,
      };
      if (d.password.trim()) body.password = d.password.trim();
      return d.id ? updateMailAccount(d.id, body) : createMailAccount(body);
    },
    onSuccess: (data, d) => {
      accept(data);
      setDraft(null);
      toast(d.id ? 'Ящик сохранён' : 'Ящик подключён — нажмите «Проверить»');
    },
    onError: toastError,
  });

  const remove = async (account: MailAccount) => {
    const ok = await askConfirm({
      title: `Отключить ${account.user}?`,
      text: [
        'Ящик пропадёт из раздела «Почта» у всех, кому был назначен. Письма на почтовом сервере останутся на месте.',
      ],
      yes: 'Отключить',
      danger: true,
    });
    if (!ok) return;
    try {
      accept(await deleteMailAccount(account.id));
      toast('Ящик отключён');
    } catch (e) {
      toastError(e);
    }
  };

  const check = async (account: MailAccount) => {
    setChecks((prev) => ({ ...prev, [account.id]: 'busy' }));
    try {
      const result = await checkMailAccount(account.id);
      setChecks((prev) => ({ ...prev, [account.id]: result }));
    } catch (e) {
      setChecks((prev) => {
        const next = { ...prev };
        delete next[account.id];
        return next;
      });
      toastError(e);
    }
  };

  if (accounts.isLoading && !accounts.data) return <p className="hint">Читаю список ящиков…</p>;
  if (accounts.isError || !accounts.data)
    return <p className="hint">{(accounts.error as Error)?.message ?? 'Не удалось прочитать ящики'}</p>;

  const data = accounts.data;
  const full = data.accounts.length >= data.max_accounts;

  return (
    <div className="mailboxes">
      {data.accounts.length === 0 && !draft && (
        <p className="hint">Пока ни одного ящика. Подключите первый — раздел «Почта» заработает сразу.</p>
      )}

      {data.accounts.map((account) => {
        const result = checks[account.id];
        const provider = data.providers.find((p) => p.key === account.provider);
        return (
          <div key={account.id} className={account.active ? 'mailbox-card' : 'mailbox-card off'}>
            <div className="mailbox-main">
              <div className="mailbox-name">
                <b>{account.title || account.user}</b>
                <span className={`mailbox-provider ${account.provider}`}>{provider?.title ?? 'Почта'}</span>
                {!account.active && <span className="mailbox-provider muted">выключен</span>}
              </div>
              <div className="mailbox-address">{account.user}</div>
              <div className="mailbox-meta">
                {account.imap_effective || 'IMAP не указан'} · {account.smtp_effective || 'SMTP не указан'}
                {account.sender_name && <> · подпись «{account.sender_name}»</>}
              </div>
              <div className="mailbox-meta">
                {account.employees.length > 0
                  ? `Назначен: ${account.employees.join(', ')}`
                  : 'Никому не назначен — виден только администратору. Назначить: «Сотрудники» → профиль.'}
              </div>
              {result && result !== 'busy' && (
                <div className={result.ok ? 'settings-status ok' : 'settings-status bad'}>
                  {result.ok
                    ? `Всё работает: в ящике ${result.total} писем, непрочитанных ${result.unseen}.`
                    : `Чтение (IMAP): ${noDot(result.imap)}. Отправка (SMTP): ${noDot(result.smtp)}.`}
                  {!result.ok && result.hint && <div className="mailbox-hint">{result.hint}</div>}
                </div>
              )}
            </div>
            <div className="mailbox-actions">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={result === 'busy'}
                onClick={() => void check(account)}
              >
                {result === 'busy' ? 'Проверяю…' : 'Проверить'}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() =>
                  setDraft({
                    id: account.id,
                    title: account.title,
                    provider: account.provider,
                    user: account.user,
                    password: '',
                    imap: account.imap,
                    smtp: account.smtp,
                    sender_name: account.sender_name,
                    active: account.active,
                  })
                }
              >
                Изменить
              </button>
              <button className="btn btn-ghost danger" type="button" onClick={() => void remove(account)}>
                Отключить
              </button>
            </div>
          </div>
        );
      })}

      {draft ? (
        <AccountForm
          draft={draft}
          providers={data.providers}
          existing={draft.id ? data.accounts.find((a) => a.id === draft.id) : undefined}
          busy={save.isPending}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => save.mutate(draft)}
        />
      ) : (
        <button
          className="btn btn-ghost"
          type="button"
          disabled={full}
          title={full ? `Подключено ${data.max_accounts} ящиков — это предел` : undefined}
          onClick={() => setDraft(EMPTY)}
        >
          + Подключить ящик
        </button>
      )}

      <p className="hint">
        Сотруднику можно назначить не больше {data.max_per_employee} ящиков — в его профиле, раздел
        «Сотрудники». Администратор видит все подключённые.
      </p>
    </div>
  );
}

function AccountForm({
  draft,
  providers,
  existing,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  providers: MailProvider[];
  existing?: MailAccount;
  busy: boolean;
  onChange: (next: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const providerKey = draft.provider || guessProvider(draft.user) || 'yandex';
  const provider = providers.find((p) => p.key === providerKey);
  const custom = providerKey === 'custom';
  const ready =
    draft.user.includes('@') &&
    (Boolean(draft.id) || draft.password.trim().length > 0) &&
    (!custom || (draft.imap.trim() && draft.smtp.trim()));

  return (
    <div className="mailbox-form">
      <b>{draft.id ? 'Правка ящика' : 'Новый ящик'}</b>
      <div className="grid">
        <Field label="Адрес ящика" hint="Полный адрес: zakaz@yandex.ru, print@mail.ru">
          <input
            type="email"
            value={draft.user}
            placeholder="print@mail.ru"
            autoComplete="off"
            onChange={(e) => set({ user: e.target.value })}
          />
        </Field>
        <Field label="Почтовая служба" hint="Определяется по адресу; от неё зависят серверы">
          <Select
            value={providerKey}
            options={providers.map((p) => ({ value: p.key, label: p.title }))}
            onChange={(v) => set({ provider: v })}
          />
        </Field>
      </div>
      <div className="grid" style={{ marginTop: 13 }}>
        <Field
          label="Пароль для почтовых программ"
          hint={
            existing?.has_password
              ? 'Задан. Пусто — оставить прежний; чтобы сменить, введите новый.'
              : 'Не пароль от аккаунта — отдельный, см. подсказку ниже'
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            value={draft.password}
            placeholder={existing?.has_password ? '••••••••••••' : ''}
            onChange={(e) => set({ password: e.target.value })}
          />
        </Field>
        <Field label="Название в переключателе" hint="Как сотрудники различают ящики: «Заказы», «Бухгалтерия»">
          <input
            type="text"
            value={draft.title}
            maxLength={60}
            placeholder="Заказы"
            onChange={(e) => set({ title: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid" style={{ marginTop: 13 }}>
        <Field label="Сервер IMAP" hint={custom ? 'Чтение писем, с портом' : `Пусто — ${provider?.imap}`}>
          <input
            type="text"
            value={draft.imap}
            placeholder={provider?.imap || 'imap.example.ru:993'}
            onChange={(e) => set({ imap: e.target.value })}
          />
        </Field>
        <Field label="Сервер SMTP" hint={custom ? 'Отправка писем, с портом' : `Пусто — ${provider?.smtp}`}>
          <input
            type="text"
            value={draft.smtp}
            placeholder={provider?.smtp || 'smtp.example.ru:465'}
            onChange={(e) => set({ smtp: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid" style={{ marginTop: 13 }}>
        <Field label="Имя отправителя" hint="Как подписаны исходящие. Пусто — название мастерской">
          <input
            type="text"
            value={draft.sender_name}
            maxLength={120}
            onChange={(e) => set({ sender_name: e.target.value })}
          />
        </Field>
        <Field label="Состояние" hint="Выключенный ящик остаётся в списке, но в «Почте» не показывается">
          <Select
            value={draft.active ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'Включён' },
              { value: 'off', label: 'Выключен' },
            ]}
            onChange={(v) => set({ active: v === 'on' })}
          />
        </Field>
      </div>
      {provider?.hint && <p className="mailbox-hint">{provider.hint}</p>}
      <div className="mailbox-form-actions">
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="btn btn-green" type="button" disabled={busy || !ready} onClick={onSave}>
          {busy ? 'Сохраняю…' : draft.id ? 'Сохранить ящик' : 'Подключить'}
        </button>
      </div>
    </div>
  );
}
