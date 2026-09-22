/* Почта мастерской: список частями, письмо, ответ, что нового.

   Ящиков может быть несколько: сотруднику администратор назначает один или
   два, сам видит все. Выбранный ящик живёт здесь, в модуле, — все запросы
   сами дописывают ?account=N, и страницам не нужно носить номер с собой.

   Список не грузится целиком: страница — 30 писем «старше такого-то» или
   «новее такого-то» (см. MailPage). Число непрочитанных живёт в маленьком
   хранилище здесь же: его обновляет опрос «что нового», а читают значок в
   шапке и заголовок списка. */

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useAuth } from '@/app/AuthProvider';

import { request } from './client';

export interface MailAddress {
  name: string;
  email: string;
}

export interface MailSummary {
  uid: number;
  from: MailAddress;
  to: MailAddress[];
  subject: string;
  /** ISO; пусто, если дата в письме не разобралась */
  date: string;
  message_id: string;
  has_attachments: boolean;
  seen: boolean;
  flagged: boolean;
}

export interface MailPageData {
  messages: MailSummary[];
  has_older: boolean;
  has_newer: boolean;
  total: number;
}

export interface MailAttachment {
  index: number;
  filename: string;
  content_type: string;
  size: number;
}

export interface MailDetail extends MailSummary {
  /** папка: INBOX или отправленные — ссылка «в ответ на» может вести в обе */
  folder: string;
  /** Message-ID письма, на которое это отвечает; пусто — не ответ */
  in_reply_to: string;
  reply_to: MailAddress;
  cc: MailAddress[];
  text: string;
  was_html: boolean;
  /** вычищенный HTML для изолированной рамки; пусто — письмо текстовое */
  html: string;
  attachments: MailAttachment[];
}

/** Ящик в переключателе: без серверов и пароля. */
export interface MailBox {
  id: number;
  title: string;
  user: string;
  provider: string;
}

export interface MailFreshBox extends MailBox {
  latest_uid: number;
  unseen: number;
  messages: MailSummary[];
  /** ящик не ответил — остальные при этом работают */
  error: string;
}

export interface MailFresh {
  configured: boolean;
  /** сумма по всем ящикам человека */
  unseen: number;
  accounts: MailFreshBox[];
}

export interface MailStatus {
  configured: boolean;
  /** почему почты нет: none — ящики не подключены, unassigned — не назначен */
  reason: '' | 'none' | 'unassigned';
  account: number | null;
  user: string;
  unseen: number;
  latest_uid: number;
  accounts: MailBox[];
  /** выбранный ящик не ответил; переключатель при этом работает */
  error: string;
}

/** Ящик глазами администратора: со всеми настройками, но без пароля. */
export interface MailAccount extends MailBox {
  imap: string;
  smtp: string;
  imap_effective: string;
  smtp_effective: string;
  sender_name: string;
  active: boolean;
  has_password: boolean;
  /** кому назначен */
  employees: string[];
}

export interface MailProvider {
  key: string;
  title: string;
  imap: string;
  smtp: string;
  hint: string;
}

export interface MailAccountsData {
  accounts: MailAccount[];
  providers: MailProvider[];
  max_per_employee: number;
  max_accounts: number;
}

export interface MailAccountPayload {
  title?: string;
  provider?: string;
  user?: string;
  password?: string;
  imap?: string;
  smtp?: string;
  sender_name?: string;
  active?: boolean;
}

export interface MailCheck {
  ok: boolean;
  imap: string;
  smtp: string;
  unseen: number;
  total: number;
  /** что проверить, если не пустило: у каждой почтовой службы своё */
  hint?: string;
}

export const PAGE = 30;

/* ---------------------------------------------------- выбранный ящик */
const ACCOUNT_KEY = 'poster.mail.account';
let currentAccount: number | null = null;
try {
  currentAccount = Number(localStorage.getItem(ACCOUNT_KEY)) || null;
} catch {
  // хранилище недоступно — просто начнём с первого ящика
}

export const getMailAccount = (): number | null => currentAccount;

export function setMailAccount(id: number | null): void {
  currentAccount = id;
  try {
    if (id) localStorage.setItem(ACCOUNT_KEY, String(id));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // не запомнили — не страшно
  }
}

/** Дописывает к пути номер выбранного ящика. */
function withAccount(path: string): string {
  if (!currentAccount) return path;
  return `${path}${path.includes('?') ? '&' : '?'}account=${currentAccount}`;
}

export const fetchMailStatus = (): Promise<MailStatus> => request<MailStatus>(withAccount('/mail/status'));

/* ---------------------------------------------------- управление ящиками (администратор) */
export const fetchMailAccounts = (): Promise<MailAccountsData> => request('/mail-accounts');

export const createMailAccount = (body: MailAccountPayload): Promise<MailAccountsData> =>
  request('/mail-accounts', { method: 'POST', body });

export const updateMailAccount = (id: number, body: MailAccountPayload): Promise<MailAccountsData> =>
  request(`/mail-accounts/${id}`, { method: 'PATCH', body });

export const deleteMailAccount = (id: number): Promise<MailAccountsData> =>
  request(`/mail-accounts/${id}`, { method: 'DELETE' });

export const checkMailAccount = (id: number): Promise<MailCheck> =>
  request<MailCheck>(`/mail-accounts/${id}/check`, { method: 'POST' });

/** Свои адресаты — «Директор», «Цех»: задаются в настройках, подставляются в «Кому». */
export const fetchMailContacts = (): Promise<{ contacts: MailAddress[] }> => request('/mail/contacts');

export function fetchMailPage(
  opts: { before?: number; after?: number; limit?: number } = {},
): Promise<MailPageData> {
  const q = new URLSearchParams();
  if (opts.before) q.set('before', String(opts.before));
  if (opts.after !== undefined) q.set('after', String(opts.after));
  q.set('limit', String(opts.limit ?? PAGE));
  return request<MailPageData>(withAccount(`/mail/messages?${q}`));
}

export const INBOX = 'INBOX';

const folderQuery = (folder: string): string =>
  folder && folder !== INBOX ? `?folder=${encodeURIComponent(folder)}` : '';

export const fetchMailMessage = (uid: number, folder = INBOX): Promise<MailDetail> =>
  request<MailDetail>(withAccount(`/mail/messages/${uid}${folderQuery(folder)}`));

/** Письмо, на которое ссылаются (In-Reply-To): ищется во входящих и отправленных. */
export const fetchMailRef = (messageId: string): Promise<{ found: boolean; message: MailDetail | null }> =>
  request(withAccount(`/mail/ref?id=${encodeURIComponent(messageId)}`));

/** after — последние виденные UID по ящикам: {1: 120, 2: 55}. */
export const fetchMailFresh = (after: Record<number, number> | null): Promise<MailFresh> => {
  const marks = Object.entries(after ?? {})
    .map(([id, uid]) => `${id}:${uid}`)
    .join(',');
  return request<MailFresh>(`/mail/fresh${marks ? `?after=${marks}` : ''}`);
};

export const setMailSeen = (uid: number, seen: boolean): Promise<{ uid: number; seen: boolean }> =>
  request(withAccount(`/mail/messages/${uid}/seen`), { method: 'POST', body: { seen } });

export const replyMail = (uid: number, text: string): Promise<{ to: MailAddress; subject: string }> =>
  request(withAccount(`/mail/messages/${uid}/reply`), { method: 'POST', body: { text } });

export const sendMail = (to: string, subject: string, text: string): Promise<{ to: string[] }> =>
  request(withAccount('/mail/send'), { method: 'POST', body: { to, subject, text } });

export const attachmentPath = (uid: number, index: number, folder = INBOX): string =>
  withAccount(`/mail/messages/${uid}/attachments/${index}${folderQuery(folder)}`);

/* ---------------------------------------------------- непрочитанные и свежие */
interface BoxState {
  unseen: number;
  latestUid: number;
}

interface MailStore {
  /** непрочитанных во всех ящиках человека — для значка в шапке */
  unseen: number;
  configured: boolean | null;
  /** по каждому ящику: непрочитанные и самый свежий UID */
  boxes: Record<number, BoxState>;
}

let store: MailStore = { unseen: 0, configured: null, boxes: {} };
const listeners = new Set<() => void>();

function setStore(next: Partial<MailStore>) {
  const merged = { ...store, ...next };
  if (
    merged.unseen === store.unseen &&
    merged.configured === store.configured &&
    JSON.stringify(merged.boxes) === JSON.stringify(store.boxes)
  )
    return;
  store = merged;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Непрочитанные по всем ящикам и по каждому — из последнего опроса. */
export function useMailStore(): MailStore {
  return useSyncExternalStore(subscribe, () => store);
}

const EMPTY_BOX: BoxState = { unseen: 0, latestUid: 0 };

/** Непрочитанные и свежий UID одного ящика. */
export function useMailBox(id: number | null): BoxState {
  const all = useMailStore();
  return (id && all.boxes[id]) || EMPTY_BOX;
}

/** Прочитали письмо — значок уменьшается сразу, не дожидаясь опроса. */
export function noteSeen(): void {
  const id = currentAccount;
  const box = id ? store.boxes[id] : undefined;
  setStore({
    unseen: Math.max(store.unseen - 1, 0),
    boxes: id && box ? { ...store.boxes, [id]: { ...box, unseen: Math.max(box.unseen - 1, 0) } } : store.boxes,
  });
}

export const MAIL_POLL_MS = 30_000;

/** Опрос «что нового в почте». Как у заказов: первый ответ — точка отсчёта,
 *  дальше на каждое новое непрочитанное зовёт onFresh. Сервер держит ответ
 *  в кэше 20 с, поэтому несколько рабочих мест ящик не мучают. */
export function useFreshMail(onFresh: (messages: MailSummary[], box: MailBox) => void): void {
  const { session, can } = useAuth();
  const enabled = Boolean(session) && can('mail.access');
  const after = useRef<Record<number, number> | null>(null);
  const handler = useRef(onFresh);
  handler.current = onFresh;

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let busy = false;

    const poll = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const fresh = await fetchMailFresh(after.current);
        if (stopped) return;
        const boxes: Record<number, BoxState> = {};
        for (const box of fresh.accounts) {
          // ящик не ответил — оставляем прежние цифры, а не обнуляем значок
          boxes[box.id] = box.error
            ? (store.boxes[box.id] ?? EMPTY_BOX)
            : { unseen: box.unseen, latestUid: box.latest_uid };
        }
        const unseen = Object.values(boxes).reduce((sum, b) => sum + b.unseen, 0);
        setStore({ unseen, configured: fresh.configured, boxes });
        if (!fresh.configured) return;
        const marks: Record<number, number> = {};
        for (const box of fresh.accounts) {
          const seenBefore = after.current?.[box.id];
          // новый для нас ящик (назначили только что) — первая встреча лишь отметка
          if (seenBefore !== undefined && box.messages.length > 0) handler.current(box.messages, box);
          marks[box.id] = box.error ? (seenBefore ?? 0) : box.latest_uid;
        }
        after.current = marks;
      } catch {
        // почта недоступна — значок просто не меняется
      } finally {
        busy = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), MAIL_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
