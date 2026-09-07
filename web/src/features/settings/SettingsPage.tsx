/* Раздел «Настройки»: реквизиты мастерской и оплаты.

   Раньше всё это жило только в .env — файле рядом с программой. Работало,
   пока настраивал тот, кто ставил систему; но правит реквизиты владелец,
   и лезть в файл он не должен. Значение, записанное здесь, главнее .env;
   пустое поле, сохранённое здесь, тоже главнее — .env его не подставит. */

import { useEffect, useState } from 'react';

import { checkMail, type MailAddress, type MailCheck } from '@/api/mail';
import { useSaveSettings, useSettings } from '@/api/settings';
import { useToast } from '@/app/ToastProvider';
import { Select } from '@/components/Select';
import { Empty, Field, Loading, PageHead, Section } from '@/components/ui';
import type { SettingsSnapshot } from '@/types/api';

const MAX_LOGO_BYTES = 400 * 1024;

const SOURCE_LABEL = { db: 'сохранено здесь', env: 'из .env', empty: '' } as const;

/* свои адресаты хранятся одной строкой JSON — разбираем и собираем здесь */
function parseContacts(raw: string | undefined): MailAddress[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data)
      ? data
          .filter((c): c is MailAddress => typeof c === 'object' && c !== null)
          .map((c) => ({ name: String(c.name ?? ''), email: String(c.email ?? '') }))
      : [];
  } catch {
    return [];
  }
}
const serializeContacts = (list: MailAddress[]): string =>
  list.length ? JSON.stringify(list.map((c) => ({ name: c.name.trim(), email: c.email.trim() }))) : '';

export function SettingsPage() {
  const settings = useSettings();
  const save = useSaveSettings();
  const { toast, toastError } = useToast();

  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [mailCheck, setMailCheck] = useState<MailCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const runMailCheck = async () => {
    setChecking(true);
    try {
      setMailCheck(await checkMail());
    } catch (e) {
      toastError(e);
    } finally {
      setChecking(false);
    }
  };

  // первый ответ сервера — в форму; дальше форма живёт своей жизнью,
  // чтобы фоновое перечитывание не затирало введённое
  useEffect(() => {
    if (settings.data && !dirty && Object.keys(values).length === 0) {
      setValues(settings.data.values);
    }
  }, [settings.data, dirty, values]);

  if (settings.isLoading && !settings.data) return <Loading />;
  if (settings.isError || !settings.data) {
    return <Empty>{(settings.error as Error)?.message ?? 'Не удалось прочитать настройки'}</Empty>;
  }
  const snap: SettingsSnapshot = settings.data;

  const set = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const source = (key: string) => {
    const label = SOURCE_LABEL[snap.sources[key] ?? 'empty'];
    return label ? <span className="settings-src">{label}</span> : null;
  };

  const onLogo = (file: File | null) => {
    if (!file) {
      set('shop_logo', '');
      return;
    }
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) {
      toast('Логотип — картинка PNG, JPG, SVG или WebP');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast(`Картинка больше ${MAX_LOGO_BYTES / 1024} КБ — уменьшите её`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('shop_logo', String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    try {
      await save.mutateAsync(values);
      setDirty(false);
      toast('Настройки сохранены');
    } catch (e) {
      toastError(e);
    }
  };

  const text = (key: string, placeholder = '') => (
    <input
      type="text"
      value={values[key] ?? ''}
      placeholder={placeholder}
      onChange={(e) => set(key, e.target.value)}
    />
  );

  const mode = values.pay_mode || (values.pay_link ? 'link' : 'gost');

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Настройки"
          title="Реквизиты"
          sub="Что печатается в шапке квитанции и что показывается клиенту на вопрос «куда платить». Значение, сохранённое здесь, главнее того, что записано в .env."
          actions={
            <button
              className="btn btn-green"
              type="button"
              disabled={save.isPending || !dirty}
              onClick={submit}
            >
              {save.isPending ? 'Сохраняю…' : 'Сохранить'}
            </button>
          }
        />

        <Section title="Мастерская — шапка квитанции">
          <div className="grid">
            <Field label={<>Название {source('shop_name')}</>}>{text('shop_name', 'ПОСТЕР')}</Field>
            <Field label={<>Телефон {source('shop_phone')}</>}>
              {text('shop_phone', '+7 (988) 000-00-00')}
            </Field>
          </div>
          <div className="grid" style={{ marginTop: 13 }}>
            <Field label={<>Адрес {source('shop_address')}</>}>{text('shop_address', 'ул. Ленина, 1')}</Field>
            <Field label={<>Строка под адресом {source('shop_note')}</>}>
              {text('shop_note', 'пн–пт 9:00–19:00')}
            </Field>
          </div>
          <div className="grid one" style={{ marginTop: 13 }}>
            <Field
              label="Логотип"
              hint="PNG, JPG или SVG до 400 КБ. Печатается слева от названия в квитанции. Пусто — только название."
            >
              <div className="settings-logo">
                {values.shop_logo && <img src={values.shop_logo} alt="Логотип" />}
                <input type="file" accept="image/*" onChange={(e) => onLogo(e.target.files?.[0] ?? null)} />
                {values.shop_logo && (
                  <button className="btn btn-ghost" type="button" onClick={() => onLogo(null)}>
                    Убрать
                  </button>
                )}
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Почта — рабочий ящик">
          <p className="settings-sub">
            Раздел «Почта»: письма клиентов читаются здесь, ответ уходит с этого ящика, о новых всплывает
            уведомление. Ящик один на всех, личный сюда не подключают: пароль хранится на сервере.
          </p>
          <div className="settings-grid">
            <Field label={<>Ящик {source('mail_user')}</>} hint="Полный адрес, например zakaz@yandex.ru">
              {text('mail_user', 'zakaz@yandex.ru')}
            </Field>
            <Field
              label={<>Пароль приложения {source('mail_password')}</>}
              hint={
                snap.secrets?.mail_password
                  ? 'Задан. Пусто — оставить прежний; чтобы сменить, введите новый.'
                  : 'Не пароль от аккаунта: id.yandex.ru → Безопасность → Пароли приложений → Почта'
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                value={values.mail_password ?? ''}
                placeholder={snap.secrets?.mail_password ? '••••••••••••' : 'abcdefghijklmnop'}
                onChange={(e) => set('mail_password', e.target.value)}
              />
            </Field>
            <Field label={<>Сервер IMAP {source('mail_imap')}</>} hint="Чтение. Пусто — imap.yandex.ru:993">
              {text('mail_imap', 'imap.yandex.ru:993')}
            </Field>
            <Field label={<>Сервер SMTP {source('mail_smtp')}</>} hint="Отправка. Пусто — smtp.yandex.ru:465">
              {text('mail_smtp', 'smtp.yandex.ru:465')}
            </Field>
            <Field
              label={<>Имя отправителя {source('mail_sender')}</>}
              hint="Как подписаны исходящие. Пусто — название мастерской"
            >
              {text('mail_sender', 'Печатный цех ПОСТЕР')}
            </Field>
          </div>
          <div className="settings-check">
            <button
              className="btn btn-ghost"
              type="button"
              disabled={checking || dirty}
              onClick={() => void runMailCheck()}
            >
              {checking ? 'Проверяю…' : 'Проверить соединение'}
            </button>
            {dirty && <span className="hint">Сначала сохраните.</span>}
            {mailCheck && !dirty && (
              <span className={mailCheck.ok ? 'settings-status ok' : 'settings-status bad'}>
                {mailCheck.ok
                  ? `Всё работает: в ящике ${mailCheck.total} писем, непрочитанных ${mailCheck.unseen}.`
                  : `Чтение (IMAP): ${mailCheck.imap}. Отправка (SMTP): ${mailCheck.smtp}.`}
              </span>
            )}
          </div>
          <p className="hint">
            Яндекс: включите IMAP в настройках ящика (Почта → Настройки → Почтовые программы) и выпустите
            пароль приложения. Нужна двухфакторная защита аккаунта — без неё Яндекс пароли приложений не
            выдаёт.
          </p>
        </Section>

        <Section title="Почта — свои адресаты">
          <p className="settings-sub">
            Кому сотрудники пишут чаще всего: директор, цех, бухгалтерия. В окне «Написать» эти адреса
            подставляются одним нажатием — помнить почту не нужно.
          </p>
          <ContactsEditor
            list={parseContacts(values.mail_contacts)}
            onChange={(list) => set('mail_contacts', serializeContacts(list))}
          />
        </Section>

        <Section title="Оплата — что видит клиент">
          <div className="grid">
            <Field
              label="Что показывать в QR"
              hint="Ссылка — для перевода физлицу, её выдаёт банк. По реквизитам — платёж на счёт организации по ГОСТ. Пусто — ссылка, если она есть."
            >
              <Select
                value={values.pay_mode ?? ''}
                options={[
                  { value: '', label: 'Решать по ссылке (есть — её)' },
                  { value: 'link', label: 'Ссылка на перевод' },
                  { value: 'gost', label: 'Платёж по реквизитам (ГОСТ)' },
                ]}
                onChange={(v) => set('pay_mode', v)}
              />
            </Field>
            <Field
              label={<>Ссылка на перевод {source('pay_link')}</>}
              hint="{phone} — подставится номер ниже, {amount} — сумма заказа"
            >
              {text('pay_link', 'https://www.sberbank.ru/ru/choise_bank?requisiteNumber={phone}&bankCode=…')}
            </Field>
          </div>

          <div className="grid" style={{ marginTop: 13 }}>
            <Field label={<>Карта {source('pay_card')}</>}>{text('pay_card', '2202 2002 1234 5678')}</Field>
            <Field label={<>Телефон для перевода {source('pay_phone')}</>}>
              {text('pay_phone', '+7 (988) 160-32-18')}
            </Field>
          </div>
          <div className="grid one" style={{ marginTop: 13 }}>
            <Field label={<>Строка под реквизитами {source('pay_note')}</>}>
              {text('pay_note', 'Перевод по СБП — в комментарии укажите номер заказа')}
            </Field>
          </div>

          <h4 className="settings-sub">Реквизиты организации — для платежа по ГОСТ</h4>
          <div className="grid">
            <Field label={<>Получатель {source('pay_name')}</>}>{text('pay_name', 'ООО Ромашка')}</Field>
            <Field label={<>Банк {source('pay_bank')}</>}>{text('pay_bank', 'Сбербанк')}</Field>
          </div>
          <div className="grid" style={{ marginTop: 13 }}>
            <Field label={<>Расчётный счёт, 20 цифр {source('pay_account')}</>}>{text('pay_account')}</Field>
            <Field label={<>БИК, 9 цифр {source('pay_bic')}</>}>{text('pay_bic')}</Field>
          </div>
          <div className="grid" style={{ marginTop: 13 }}>
            <Field label={<>Корр. счёт, 20 цифр {source('pay_corr_account')}</>}>
              {text('pay_corr_account')}
            </Field>
            <Field label={<>ИНН {source('pay_inn')}</>}>{text('pay_inn')}</Field>
          </div>
          <div className="grid" style={{ marginTop: 13 }}>
            <Field label={<>КПП {source('pay_kpp')}</>}>{text('pay_kpp')}</Field>
            <Field
              label="Кодировка строки"
              hint="Если приложение какого-то банка не читает QR — попробуйте win1251"
            >
              <Select
                value={values.pay_encoding || 'utf8'}
                options={[
                  { value: 'utf8', label: 'UTF-8 (по умолчанию)' },
                  { value: 'win1251', label: 'Windows-1251' },
                ]}
                onChange={(v) => set('pay_encoding', v)}
              />
            </Field>
          </div>

          {/* проверка реквизитов — здесь, а не у стойки при клиенте */}
          {dirty ? (
            <div className="settings-status hint">Сохраните — и реквизиты проверятся.</div>
          ) : snap.qr_ready ? (
            <div className="settings-status ok">
              QR готов: {mode === 'link' ? 'ссылка на перевод' : 'платёж по реквизитам'}.
              {snap.hints.length > 0 && (
                <ul>
                  {snap.hints.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="settings-status bad">
              QR пока не показывается:
              <ul>
                {snap.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>
    </main>
  );
}

/* Список «имя — адрес» с добавлением и удалением строк. */
function ContactsEditor({
  list,
  onChange,
}: {
  list: MailAddress[];
  onChange: (list: MailAddress[]) => void;
}) {
  const update = (i: number, patch: Partial<MailAddress>) =>
    onChange(list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div className="contacts-editor">
      {list.map((c, i) => (
        <div className="contacts-row" key={i}>
          <input
            type="text"
            value={c.name}
            placeholder="Директор"
            aria-label="Имя адресата"
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            type="email"
            value={c.email}
            placeholder="director@example.com"
            aria-label="Адрес"
            onChange={(e) => update(i, { email: e.target.value })}
          />
          <button
            className="icon-btn"
            type="button"
            aria-label="Убрать адресата"
            title="Убрать"
            onClick={() => onChange(list.filter((_, idx) => idx !== i))}
          >
            <svg viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
      <button
        className="btn btn-ghost"
        type="button"
        onClick={() => onChange([...list, { name: '', email: '' }])}
      >
        + Добавить адресата
      </button>
    </div>
  );
}
