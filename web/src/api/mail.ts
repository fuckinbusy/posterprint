/* Почта мастерской: список частями, письмо, ответ, что нового.

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

export interface MailFresh {
  configured: boolean;
  latest_uid: number;
  unseen: number;
  messages: MailSummary[];
}

export interface MailStatus {
  configured: boolean;
  user: string;
  unseen: number;
  latest_uid: number;
}

export interface MailCheck {
  ok: boolean;
  imap: string;
  smtp: string;
  unseen: number;
  total: number;
}

export const PAGE = 30;

export const fetchMailStatus = (): Promise<MailStatus> => request<MailStatus>('/mail/status');

/** Свои адресаты — «Директор», «Цех»: задаются в настройках, подставляются в «Кому». */
export const fetchMailContacts = (): Promise<{ contacts: MailAddress[] }> => request('/mail/contacts');

export function fetchMailPage(
  opts: { before?: number; after?: number; limit?: number } = {},
): Promise<MailPageData> {
  const q = new URLSearchParams();
  if (opts.before) q.set('before', String(opts.before));
  if (opts.after !== undefined) q.set('after', String(opts.after));
  q.set('limit', String(opts.limit ?? PAGE));
  return request<MailPageData>(`/mail/messages?${q}`);
}

export const INBOX = 'INBOX';

const folderQuery = (folder: string): string =>
  folder && folder !== INBOX ? `?folder=${encodeURIComponent(folder)}` : '';

export const fetchMailMessage = (uid: number, folder = INBOX): Promise<MailDetail> =>
  request<MailDetail>(`/mail/messages/${uid}${folderQuery(folder)}`);

/** Письмо, на которое ссылаются (In-Reply-To): ищется во входящих и отправленных. */
export const fetchMailRef = (messageId: string): Promise<{ found: boolean; message: MailDetail | null }> =>
  request(`/mail/ref?id=${encodeURIComponent(messageId)}`);

export const fetchMailFresh = (after: number | null): Promise<MailFresh> =>
  request<MailFresh>(`/mail/fresh${after === null ? '' : `?after=${after}`}`);

export const setMailSeen = (uid: number, seen: boolean): Promise<{ uid: number; seen: boolean }> =>
  request(`/mail/messages/${uid}/seen`, { method: 'POST', body: { seen } });

export const replyMail = (uid: number, text: string): Promise<{ to: MailAddress; subject: string }> =>
  request(`/mail/messages/${uid}/reply`, { method: 'POST', body: { text } });

export const sendMail = (to: string, subject: string, text: string): Promise<{ to: string[] }> =>
  request('/mail/send', { method: 'POST', body: { to, subject, text } });

export const checkMail = (): Promise<MailCheck> => request<MailCheck>('/mail/check', { method: 'POST' });

export const attachmentPath = (uid: number, index: number, folder = INBOX): string =>
  `/mail/messages/${uid}/attachments/${index}${folderQuery(folder)}`;

/* ---------------------------------------------------- непрочитанные и свежие */
interface MailStore {
  unseen: number;
  latestUid: number;
  configured: boolean | null;
}

let store: MailStore = { unseen: 0, latestUid: 0, configured: null };
const listeners = new Set<() => void>();

function setStore(next: Partial<MailStore>) {
  const merged = { ...store, ...next };
  if (
    merged.unseen === store.unseen &&
    merged.latestUid === store.latestUid &&
    merged.configured === store.configured
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

/** Число непрочитанных и самый свежий UID — из последнего опроса. */
export function useMailStore(): MailStore {
  return useSyncExternalStore(subscribe, () => store);
}

/** Прочитали письмо — значок уменьшается сразу, не дожидаясь опроса. */
export function noteSeen(): void {
  setStore({ unseen: Math.max(store.unseen - 1, 0) });
}

export const MAIL_POLL_MS = 30_000;

/** Опрос «что нового в почте». Как у заказов: первый ответ — точка отсчёта,
 *  дальше на каждое новое непрочитанное зовёт onFresh. Сервер держит ответ
 *  в кэше 20 с, поэтому несколько рабочих мест ящик не мучают. */
export function useFreshMail(onFresh: (messages: MailSummary[]) => void): void {
  const { session, can } = useAuth();
  const enabled = Boolean(session) && can('mail.access');
  const after = useRef<number | null>(null);
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
        setStore({ unseen: fresh.unseen, latestUid: fresh.latest_uid, configured: fresh.configured });
        if (!fresh.configured) return;
        if (after.current !== null && fresh.messages.length > 0) handler.current(fresh.messages);
        after.current = fresh.latest_uid;
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
