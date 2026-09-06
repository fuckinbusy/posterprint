/* Раздел «Почта»: слева список писем, справа письмо и ответ.

   Список — окно из трёх страниц по 30 писем, не больше. Прокрутка вниз
   догружает старые и выбрасывает самые новые из памяти; прокрутка вверх —
   наоборот. Так ящик с десятью тысячами писем листается так же легко, как
   с тридцатью: в DOM всегда не больше девяноста строк, а сервер отдаёт
   только запрошенную часть.

   Тело письма грузится по открытии, вложения — по нажатию. Открытое письмо
   отмечается прочитанным (как в любой почтовой программе), и значок в
   шапке уменьшается сразу. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';

import { downloadCsv } from '@/api/export';
import {
  PAGE,
  attachmentPath,
  fetchMailMessage,
  fetchMailPage,
  fetchMailStatus,
  noteSeen,
  replyMail,
  sendMail,
  useMailStore,
  type MailAttachment,
  type MailSummary,
} from '@/api/mail';
import { useCan } from '@/app/AuthProvider';
import { ModalShell, useModal, useModalFrame, useUnsavedGuard } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import { ArrowLeftIcon, DownloadIcon, EditIcon, FileIcon, PlusIcon } from '@/components/Icons';
import { Empty, Field, Loading } from '@/components/ui';
import { fileSize, initials } from '@/lib/format';

/* сколько строк держим в памяти: три страницы */
const WINDOW = PAGE * 3;

/* ---------------------------------------------------- дата коротко */
export function mailDate(iso: string, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'вчера';
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const who = (a: { name: string; email: string }): string => a.name || a.email || 'без адреса';

/* ==================================================== страница */
export function MailPage() {
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get('uid')) || null;
  const select = useCallback(
    (uid: number | null) => setParams(uid ? { uid: String(uid) } : {}, { replace: true }),
    [setParams],
  );
  const can = useCan();
  const status = useQuery({ queryKey: ['mail', 'status'], queryFn: fetchMailStatus, staleTime: 30 * 1000 });
  const [seenUid, setSeenUid] = useState<number | null>(null);

  if (status.isLoading && !status.data) return <Loading>Соединяюсь с почтой…</Loading>;
  if (status.isError) return <Empty>{(status.error as Error).message}</Empty>;
  if (status.data && !status.data.configured) {
    return (
      <main className="page scroll-page">
        <div className="page-inner">
          <Empty>
            Почта не настроена.{' '}
            {can('staff.manage') ? (
              <>
                Укажите ящик и пароль приложения в <NavLink to="/settings">Настройках</NavLink>.
              </>
            ) : (
              'Попросите того, кто управляет настройками, подключить ящик.'
            )}
          </Empty>
        </div>
      </main>
    );
  }

  return (
    <main className="page mail-page" aria-label="Почта">
      <MailList selected={selected} onSelect={select} seenUid={seenUid} user={status.data?.user ?? ''} />
      <MailReader uid={selected} onSeen={setSeenUid} onBack={() => select(null)} />
    </main>
  );
}

/* ==================================================== список */
interface ListState {
  items: MailSummary[];
  older: boolean;
  newer: boolean;
}

function MailList({
  selected,
  onSelect,
  seenUid,
  user,
}: {
  selected: number | null;
  onSelect: (uid: number) => void;
  seenUid: number | null;
  user: string;
}) {
  const modal = useModal();
  const { unseen, latestUid } = useMailStore();
  const [list, setList] = useState<ListState>({ items: [], older: false, newer: false });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const bottomSentinel = useRef<HTMLDivElement>(null);
  // высота до вставки сверху: после неё возвращаем взгляд на ту же строку
  const keepFrom = useRef<number | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const page = await fetchMailPage({ limit: PAGE });
      setList({ items: page.messages, older: page.has_older, newer: page.has_newer });
      setPhase('ready');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* вниз: старые письма добавляются в конец, лишние новые — выбрасываются */
  const loadOlder = useCallback(async () => {
    if (busy.current || !list.older || list.items.length === 0) return;
    busy.current = true;
    try {
      const last = list.items[list.items.length - 1];
      const page = await fetchMailPage({ before: last.uid });
      setList((prev) => {
        let items = [...prev.items, ...page.messages];
        const dropped = items.length > WINDOW;
        if (dropped) items = items.slice(items.length - WINDOW);
        return { items, older: page.has_older, newer: dropped || prev.newer };
      });
    } catch {
      /* следующая прокрутка попробует снова */
    } finally {
      busy.current = false;
    }
  }, [list]);

  /* вверх: новые письма вставляются в начало, лишние старые — выбрасываются */
  const loadNewer = useCallback(async (force = false) => {
    // без force — только если сверху действительно что-то выброшено:
    // иначе каждый показ верхнего часового ходил бы на сервер зря
    if (busy.current || list.items.length === 0 || (!list.newer && !force)) return;
    busy.current = true;
    try {
      const first = list.items[0];
      const page = await fetchMailPage({ after: first.uid });
      if (page.messages.length === 0) {
        setList((prev) => ({ ...prev, newer: page.has_newer }));
        return;
      }
      keepFrom.current = scroller.current?.scrollHeight ?? null;
      setList((prev) => {
        let items = [...page.messages, ...prev.items];
        const dropped = items.length > WINDOW;
        if (dropped) items = items.slice(0, WINDOW);
        return { items, newer: page.has_newer, older: dropped || prev.older };
      });
    } catch {
      /* следующая прокрутка попробует снова */
    } finally {
      busy.current = false;
    }
  }, [list]);

  // после вставки сверху сдвигаем прокрутку на высоту вставленного
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && keepFrom.current !== null) {
      el.scrollTop += el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    }
  }, [list.items]);

  // часовые у краёв: показались — грузим следующую часть
  const olderRef = useRef(loadOlder);
  const newerRef = useRef(loadNewer);
  olderRef.current = loadOlder;
  newerRef.current = loadNewer;
  useEffect(() => {
    const root = scroller.current;
    const top = topSentinel.current;
    const bottom = bottomSentinel.current;
    if (!root || !top || !bottom) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (entry.target === bottom) void olderRef.current();
          if (entry.target === top) void newerRef.current();
        });
      },
      { root, rootMargin: '120px 0px' },
    );
    observer.observe(top);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [phase]);

  // опрос сказал «есть письмо новее» — подтягиваем, если окно у верхнего края
  useEffect(() => {
    const first = list.items[0];
    if (!first || list.newer || latestUid <= first.uid) return;
    void newerRef.current(true);
  }, [latestUid, list.items, list.newer]);

  // открытое письмо — прочитано
  useEffect(() => {
    if (seenUid === null) return;
    setList((prev) =>
      prev.items.some((m) => m.uid === seenUid && !m.seen)
        ? { ...prev, items: prev.items.map((m) => (m.uid === seenUid ? { ...m, seen: true } : m)) }
        : prev,
    );
  }, [seenUid]);

  return (
    <section className={selected ? 'mail-list has-selection' : 'mail-list'} aria-label="Входящие">
      <div className="mail-list-head">
        <div>
          <span className="mail-eyebrow">Входящие</span>
          <b>{unseen > 0 ? `${unseen} непрочитанных` : 'Всё прочитано'}</b>
          {user && <small title="Рабочий ящик">{user}</small>}
        </div>
        <div className="mail-list-actions">
          <button
            className="icon-btn"
            type="button"
            title="Перечитать"
            aria-label="Перечитать"
            onClick={() => void load()}
          >
            <ArrowLeftIcon style={{ transform: 'rotate(90deg)' }} />
          </button>
          <button className="btn btn-green" type="button" onClick={() => modal.open(<ComposeModal />)}>
            <PlusIcon />
            Написать
          </button>
        </div>
      </div>

      <div className="mail-scroll" ref={scroller}>
        <div ref={topSentinel} className="mail-sentinel">
          {list.newer && <span>Новее… прокрутите вверх</span>}
        </div>
        {phase === 'loading' && list.items.length === 0 && <Loading>Читаю ящик…</Loading>}
        {phase === 'error' && <Empty>{error}</Empty>}
        {phase === 'ready' && list.items.length === 0 && <Empty>Во входящих пусто.</Empty>}
        {list.items.map((m) => (
          <MailRow key={m.uid} message={m} active={m.uid === selected} onClick={() => onSelect(m.uid)} />
        ))}
        <div ref={bottomSentinel} className="mail-sentinel">
          {list.older && list.items.length > 0 && <span>Старше…</span>}
        </div>
      </div>
    </section>
  );
}

function MailRow({
  message,
  active,
  onClick,
}: {
  message: MailSummary;
  active: boolean;
  onClick: () => void;
}) {
  const cls = ['mail-row', message.seen ? '' : 'unseen', active ? 'on' : ''].filter(Boolean).join(' ');
  return (
    <button className={cls} type="button" onClick={onClick} aria-current={active || undefined}>
      <span className="mail-avatar" aria-hidden="true">
        {initials(message.from.name || message.from.email)}
      </span>
      <span className="mail-row-body">
        <span className="mail-row-top">
          <span className="mail-from">{who(message.from)}</span>
          <time className="mail-date" dateTime={message.date}>
            {mailDate(message.date)}
          </time>
        </span>
        <span className="mail-subject">
          {message.has_attachments && <FileIcon className="mail-clip" />}
          {message.subject}
        </span>
      </span>
    </button>
  );
}

/* ==================================================== письмо */
function MailReader({
  uid,
  onSeen,
  onBack,
}: {
  uid: number | null;
  onSeen: (uid: number) => void;
  onBack: () => void;
}) {
  const detail = useQuery({
    queryKey: ['mail', 'message', uid],
    queryFn: () => fetchMailMessage(uid as number),
    enabled: uid !== null,
    staleTime: 5 * 60 * 1000,
  });

  // письмо открылось — список и значок узнают, что оно прочитано
  const reported = useRef<number | null>(null);
  useEffect(() => {
    const data = detail.data;
    if (!data || reported.current === data.uid) return;
    reported.current = data.uid;
    onSeen(data.uid);
    noteSeen();
  }, [detail.data, onSeen]);

  if (uid === null) {
    return (
      <section className="mail-read empty" aria-label="Письмо">
        <div className="mail-placeholder">
          <span className="mail-eyebrow">Почта</span>
          <p>Выберите письмо слева. Новые всплывают уведомлением, даже если вы на доске.</p>
        </div>
      </section>
    );
  }

  const m = detail.data;
  return (
    <section className="mail-read" aria-label="Письмо">
      <button className="btn btn-ghost mail-back" type="button" onClick={onBack}>
        <ArrowLeftIcon />К списку
      </button>
      {detail.isLoading && <Loading>Открываю письмо…</Loading>}
      {detail.isError && <Empty>{(detail.error as Error).message}</Empty>}
      {m && (
        <>
          <header className="mail-head">
            <h1>{m.subject}</h1>
            <div className="mail-meta">
              <span className="mail-avatar big" aria-hidden="true">
                {initials(m.from.name || m.from.email)}
              </span>
              <div>
                <b>{who(m.from)}</b>
                {m.from.name && <span className="mail-addr">{m.from.email}</span>}
                <span className="mail-to">
                  кому: {m.to.map(who).join(', ') || '—'}
                  {m.cc.length > 0 && ` · копия: ${m.cc.map(who).join(', ')}`}
                </span>
              </div>
              <time className="mail-when" dateTime={m.date}>
                {m.date
                  ? new Date(m.date).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </time>
            </div>
          </header>

          {m.attachments.length > 0 && (
            <div className="mail-atts" aria-label="Вложения">
              {m.attachments.map((a) => (
                <Attachment key={a.index} uid={m.uid} att={a} />
              ))}
            </div>
          )}

          <div className="mail-body">{m.text || <em className="hint">Письмо без текста.</em>}</div>
          {m.was_html && (
            <div className="mail-note">Письмо пришло в HTML, показан только текст — так безопаснее.</div>
          )}

          <ReplyBox uid={m.uid} to={m.reply_to} />
        </>
      )}
    </section>
  );
}

function Attachment({ uid, att }: { uid: number; att: MailAttachment }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const ok = await downloadCsv(attachmentPath(uid, att.index), att.filename);
    setBusy(false);
    if (!ok) toast('Не удалось скачать вложение');
  };
  return (
    <button
      className="mail-att"
      type="button"
      onClick={() => void download()}
      disabled={busy}
      title={att.content_type}
    >
      <DownloadIcon />
      <span>{att.filename}</span>
      <em>{fileSize(att.size)}</em>
    </button>
  );
}

/* ---------------------------------------------------- ответ */
function ReplyBox({ uid, to }: { uid: number; to: { name: string; email: string } }) {
  const { toast, toastError } = useToast();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const reply = useMutation({ mutationFn: (body: string) => replyMail(uid, body) });

  // сменили письмо — черновик ответа не переносится
  useEffect(() => {
    setText('');
    setOpen(false);
    reply.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const send = async () => {
    if (!text.trim()) return;
    try {
      const result = await reply.mutateAsync(text);
      toast(`Ответ отправлен: ${who(result.to)}`);
      setText('');
      setOpen(false);
    } catch (e) {
      toastError(e);
    }
  };

  if (!open) {
    return (
      <div className="mail-reply-cta">
        <button className="btn btn-green" type="button" onClick={() => setOpen(true)}>
          <EditIcon />
          Ответить
        </button>
        <span className="hint">
          Ответ уйдёт на {to.email || 'обратный адрес письма'} с рабочего ящика, с подписью и цитатой письма.
        </span>
      </div>
    );
  }

  return (
    <div className="mail-reply">
      <div className="mail-reply-head">
        <span className="mail-eyebrow">Ответ</span>
        <b>{who(to)}</b>
      </div>
      <textarea
        value={text}
        rows={6}
        autoFocus
        placeholder="Здравствуйте! …"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
        }}
      />
      <div className="mail-reply-foot">
        <span className="hint">Ctrl+Enter — отправить. Подпись и цитата добавятся сами.</span>
        <div className="spacer" />
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
          Отмена
        </button>
        <button
          className="btn btn-green"
          type="button"
          disabled={reply.isPending || !text.trim()}
          onClick={() => void send()}
        >
          {reply.isPending ? 'Отправляю…' : 'Отправить'}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- новое письмо */
function ComposeModal() {
  const frame = useModalFrame();
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const markClean = useUnsavedGuard(Boolean(to || subject || text));
  const send = useMutation({ mutationFn: () => sendMail(to, subject, text) });

  const submit = async () => {
    try {
      await send.mutateAsync();
      toast(`Письмо отправлено: ${to}`);
      markClean();
      frame.closeAll();
      void qc.invalidateQueries({ queryKey: ['mail'] });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <ModalShell
      eyebrow="Почта"
      title="Новое письмо"
      foot={
        <>
          <div className="spacer" />
          <button className="btn btn-ghost" type="button" onClick={frame.close}>
            Отмена
          </button>
          <button
            className="btn btn-green"
            type="button"
            disabled={send.isPending || !to.trim() || !text.trim()}
            onClick={() => void submit()}
          >
            {send.isPending ? 'Отправляю…' : 'Отправить'}
          </button>
        </>
      }
    >
      <Field label="Кому" hint="Несколько адресов — через запятую">
        <input
          type="email"
          multiple
          value={to}
          placeholder="client@example.com"
          onChange={(e) => setTo(e.target.value)}
        />
      </Field>
      <Field label="Тема">
        <input
          type="text"
          value={subject}
          placeholder="Макет баннера согласован"
          onChange={(e) => setSubject(e.target.value)}
        />
      </Field>
      <Field label="Текст" hint="Подпись с вашим именем и названием мастерской добавится сама">
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </ModalShell>
  );
}
