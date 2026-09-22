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
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';

import { downloadCsv } from '@/api/export';
import {
  INBOX,
  PAGE,
  attachmentPath,
  fetchMailMessage,
  fetchMailContacts,
  fetchMailPage,
  fetchMailRef,
  fetchMailStatus,
  getMailAccount,
  noteSeen,
  replyMail,
  sendMail,
  setMailAccount,
  useMailBox,
  useMailStore,
  type MailAttachment,
  type MailBox,
  type MailDetail,
  type MailStatus,
  type MailSummary,
} from '@/api/mail';
import { ApiError } from '@/api/client';
import { useCan } from '@/app/AuthProvider';
import { useTheme } from '@/app/theme';
import { ModalShell, useModal, useModalFrame, useUnsavedGuard } from '@/app/ModalProvider';
import { useToast } from '@/app/ToastProvider';
import {
  ArrowLeftIcon,
  CloseIcon,
  DownloadIcon,
  EditIcon,
  FileIcon,
  OpenIcon,
  PlusIcon,
} from '@/components/Icons';
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
/** Статус выбранного ящика. Запомненный ящик могли отнять или удалить —
 *  сервер ответит 403/404; тогда забываем выбор и берём первый доступный. */
async function loadStatus(): Promise<MailStatus> {
  try {
    return await fetchMailStatus();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404) && getMailAccount()) {
      setMailAccount(null);
      return fetchMailStatus();
    }
    throw e;
  }
}

export function MailPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const selected = Number(params.get('uid')) || null;
  // папка в адресе появляется только у писем из отправленных — к ним ведёт
  // ссылка «в ответ на»; список слева всегда про входящие
  const folder = params.get('folder') || INBOX;
  const select = useCallback(
    (uid: number | null) => setParams(uid ? { uid: String(uid) } : {}, { replace: true }),
    [setParams],
  );
  const can = useCan();

  // ящик из адреса (по нему ведёт уведомление о письме) главнее запомненного
  const fromUrl = Number(params.get('account')) || null;
  if (fromUrl && fromUrl !== getMailAccount()) setMailAccount(fromUrl);
  const [account, setAccount] = useState<number | null>(() => getMailAccount());
  if (fromUrl && fromUrl !== account) setAccount(fromUrl);

  const status = useQuery({
    queryKey: ['mail', 'status', account],
    queryFn: loadStatus,
    staleTime: 30 * 1000,
  });
  const [seenUid, setSeenUid] = useState<number | null>(null);

  // сервер выбрал ящик сам (первый вход или запомненный отняли) — запоминаем
  const resolved = status.data?.account ?? null;
  useEffect(() => {
    if (resolved && resolved !== getMailAccount()) {
      setMailAccount(resolved);
      setAccount(resolved);
    }
  }, [resolved]);

  const switchTo = (id: number) => {
    if (id === account) return;
    setMailAccount(id);
    setAccount(id);
    // письма и ссылки «в ответ на» у каждого ящика свои — чужой кэш не показываем
    qc.removeQueries({ queryKey: ['mail', 'message'] });
    qc.removeQueries({ queryKey: ['mail', 'ref'] });
    setParams({}, { replace: true });
  };

  if (status.isLoading && !status.data) return <Loading>Соединяюсь с почтой…</Loading>;
  if (status.isError) return <Empty>{(status.error as Error).message}</Empty>;
  if (status.data && !status.data.configured) {
    return (
      <main className="page scroll-page">
        <div className="page-inner">
          <Empty>
            {status.data.reason === 'unassigned' ? (
              'Вам не назначен почтовый ящик. Попросите администратора выбрать его в вашем профиле.'
            ) : (
              <>
                Почта не подключена.{' '}
                {can('staff.manage') ? (
                  <>
                    Добавьте ящик в <NavLink to="/settings">Настройках</NavLink> — Яндекс, Mail.ru или любой
                    другой с IMAP.
                  </>
                ) : (
                  'Попросите администратора подключить ящик.'
                )}
              </>
            )}
          </Empty>
        </div>
      </main>
    );
  }

  const boxes = status.data?.accounts ?? [];
  const current = status.data?.account ?? account;
  return (
    <main className="page mail-page" aria-label="Почта">
      <MailList
        key={`list-${current}`}
        selected={selected}
        onSelect={select}
        seenUid={seenUid}
        user={status.data?.user ?? ''}
        account={current}
        boxes={boxes}
        onSwitch={switchTo}
      />
      <MailReader
        key={`reader-${current}`}
        uid={selected}
        folder={folder}
        onSeen={setSeenUid}
        onBack={() => select(null)}
      />
    </main>
  );
}

/** Переключатель ящиков: показывается, когда их больше одного. */
function BoxSwitch({
  boxes,
  current,
  onSwitch,
}: {
  boxes: MailBox[];
  current: number | null;
  onSwitch: (id: number) => void;
}) {
  const store = useMailStore();
  if (boxes.length < 2) return null;
  return (
    <div className="mail-boxes" role="tablist" aria-label="Почтовые ящики">
      {boxes.map((box) => {
        const unseen = store.boxes[box.id]?.unseen ?? 0;
        return (
          <button
            key={box.id}
            type="button"
            role="tab"
            aria-selected={box.id === current}
            className={box.id === current ? 'mail-box on' : 'mail-box'}
            title={box.user}
            onClick={() => onSwitch(box.id)}
          >
            <span>{box.title || box.user}</span>
            {unseen > 0 && <i>{unseen > 99 ? '99+' : unseen}</i>}
          </button>
        );
      })}
    </div>
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
  account,
  boxes,
  onSwitch,
}: {
  selected: number | null;
  onSelect: (uid: number) => void;
  seenUid: number | null;
  user: string;
  account: number | null;
  boxes: MailBox[];
  onSwitch: (id: number) => void;
}) {
  const modal = useModal();
  const { unseen, latestUid } = useMailBox(account);
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
  const loadNewer = useCallback(
    async (force = false) => {
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
    },
    [list],
  );

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
          <button className="btn btn-green" type="button" onClick={() => modal.open(<ComposeModal from={user} />)}>
            <PlusIcon />
            Написать
          </button>
        </div>
      </div>

      <BoxSwitch boxes={boxes} current={account} onSwitch={onSwitch} />

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
  folder,
  onSeen,
  onBack,
}: {
  uid: number | null;
  folder: string;
  onSeen: (uid: number) => void;
  onBack: () => void;
}) {
  const detail = useQuery({
    queryKey: ['mail', 'message', folder, uid],
    queryFn: () => fetchMailMessage(uid as number, folder),
    enabled: uid !== null,
    staleTime: 5 * 60 * 1000,
  });

  // письмо открылось — список и значок узнают, что оно прочитано
  // (только входящие: отправленные в списке не живут и непрочитанными не бывают)
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const data = detail.data;
    const key = data ? `${data.folder}:${data.uid}` : null;
    if (!data || !key || reported.current === key) return;
    reported.current = key;
    if (data.folder === INBOX && !data.seen) {
      onSeen(data.uid);
      noteSeen();
    } else if (data.folder === INBOX) {
      onSeen(data.uid);
    }
  }, [detail.data, onSeen]);

  // «показать только текст» — до раннего return ниже: хуки после return
  // меняют свой порядок между рендерами, и React падает (#310), как только
  // выбирают первое письмо
  const [asText, setAsText] = useState(false);
  useEffect(() => setAsText(false), [uid]);

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

  // письмо с оформлением — в рамке; по желанию — только текст

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
            {m.folder !== INBOX && (
              <span className="mail-folder">Отправленные · письмо с рабочего ящика</span>
            )}
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

          {m.in_reply_to && <ReplyRef messageId={m.in_reply_to} />}

          {m.attachments.length > 0 && (
            <div className="mail-atts" aria-label="Вложения">
              {m.attachments.map((a) => (
                <Attachment key={a.index} uid={m.uid} folder={m.folder} att={a} />
              ))}
            </div>
          )}

          {m.html && !asText ? (
            <HtmlMail html={m.html} />
          ) : (
            <div className="mail-body">{m.text || <em className="hint">Письмо без текста.</em>}</div>
          )}
          {m.html && (
            <button className="btn-link mail-view-toggle" type="button" onClick={() => setAsText((v) => !v)}>
              {asText ? 'Показать письмо с оформлением' : 'Показать только текст'}
            </button>
          )}

          {m.folder === INBOX ? (
            <ReplyBox uid={m.uid} to={m.reply_to} />
          ) : (
            <div className="mail-reply-cta">
              <span className="hint">
                Это наше письмо. Отвечать на него не на что — ответ клиента придёт во входящие.
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------- «в ответ на» */
/* Ссылка на письмо, на которое отвечает открытое. Наведение (или нажатие —
   для планшета) раскрывает карточку с самим письмом: кто, когда, текст с
   оформлением, вложения — и кнопка перейти к нему. Работает в обе стороны:
   ответ клиента ссылается на наше письмо в отправленных, наше — на письмо
   клиента во входящих. */
function ReplyRef({ messageId }: { messageId: string }) {
  const ref = useQuery({
    queryKey: ['mail', 'ref', messageId],
    queryFn: () => fetchMailRef(messageId),
    staleTime: 10 * 60 * 1000,
  });
  const chip = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef(0);

  const clear = () => window.clearTimeout(timer.current);
  const show = () => {
    clear();
    timer.current = window.setTimeout(() => setOpen(true), 160);
  };
  const hide = () => {
    clear();
    if (pinned) return;
    timer.current = window.setTimeout(() => setOpen(false), 240);
  };
  const close = useCallback(() => {
    clear();
    setPinned(false);
    setOpen(false);
  }, []);

  useEffect(() => close(), [messageId, close]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const found = ref.data?.found ? ref.data.message : null;
  const label = ref.isLoading
    ? 'В ответ на письмо…'
    : found
      ? `В ответ на: ${found.subject}`
      : 'В ответ на письмо, которого нет в ящике';

  return (
    <div className="mail-ref-wrap">
      <button
        ref={chip}
        className={['mail-ref', found ? '' : 'missing', open ? 'on' : ''].filter(Boolean).join(' ')}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={found ? `${who(found.from)} · ${mailDate(found.date)}` : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          clear();
          setPinned((p) => !p);
          setOpen(true);
        }}
      >
        <span className="mail-ref-arrow" aria-hidden="true">
          ↩
        </span>
        <span className="mail-ref-text">{label}</span>
        {found && <small>{who(found.from)}</small>}
      </button>
      {open && (
        <RefCard
          anchor={chip.current}
          message={found}
          loading={ref.isLoading}
          pinned={pinned}
          onEnter={clear}
          onLeave={hide}
          onClose={close}
        />
      )}
    </div>
  );
}

const CARD_W = 560;

function RefCard({
  anchor,
  message,
  loading,
  pinned,
  onEnter,
  onLeave,
  onClose,
}: {
  anchor: HTMLElement | null;
  message: MailDetail | null;
  loading: boolean;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number }>({
    left: 16,
    top: 80,
    maxH: 480,
  });

  // карточка — position: fixed, под чипом; внизу не помещается — над ним
  useLayoutEffect(() => {
    const box = anchor?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(CARD_W, window.innerWidth - 32);
    const left = Math.max(16, Math.min(box.left, window.innerWidth - width - 16));
    const below = window.innerHeight - box.bottom - 16;
    const above = box.top - 16;
    if (below >= 320 || below >= above) {
      setPos({ left, top: box.bottom + 8, maxH: Math.max(240, Math.min(560, below - 8)) });
    } else {
      setPos({
        left,
        bottom: window.innerHeight - box.top + 8,
        maxH: Math.max(240, Math.min(560, above - 8)),
      });
    }
  }, [anchor]);

  const openIt = () => {
    if (!message) return;
    onClose();
    navigate(
      message.folder === INBOX
        ? `/mail?uid=${message.uid}`
        : `/mail?uid=${message.uid}&folder=${encodeURIComponent(message.folder)}`,
    );
  };

  return (
    <div
      className={pinned ? 'refcard pinned' : 'refcard'}
      role="dialog"
      aria-label="Письмо, на которое отвечают"
      style={{
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width: Math.min(CARD_W, window.innerWidth - 32),
        maxHeight: pos.maxH,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {loading && <Loading>Ищу письмо…</Loading>}
      {!loading && !message && (
        <div className="refcard-empty">
          Письма с таким номером в ящике нет: его могли удалить, или оно отправлено не с этого ящика.
        </div>
      )}
      {message && (
        <>
          <div className="refcard-head">
            <span className="mail-avatar" aria-hidden="true">
              {initials(message.from.name || message.from.email)}
            </span>
            <div className="refcard-who">
              <b>{who(message.from)}</b>
              <span>
                {message.folder === INBOX ? 'входящие' : 'отправленные'} ·{' '}
                {message.date
                  ? new Date(message.date).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </span>
            </div>
            <button className="icon-btn" type="button" aria-label="Закрыть" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <div className="refcard-subject">{message.subject}</div>
          {message.attachments.length > 0 && (
            <div className="mail-atts compact" aria-label="Вложения">
              {message.attachments.map((a) => (
                <Attachment key={a.index} uid={message.uid} folder={message.folder} att={a} />
              ))}
            </div>
          )}
          <div className="refcard-body">
            {message.html ? (
              <HtmlMail html={message.html} />
            ) : (
              <div className="mail-body">{message.text || <em className="hint">Письмо без текста.</em>}</div>
            )}
          </div>
          <div className="refcard-foot">
            <button className="btn btn-green" type="button" onClick={openIt}>
              <OpenIcon />
              Открыть письмо
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* HTML письма в изолированной рамке. sandbox без allow-scripts: внутри
   ничего не выполняется, даже если что-то проскочило через очистку на
   сервере. allow-same-origin нужен только чтобы измерить высоту содержимого
   и подогнать рамку — без скриптов это безопасно. Ссылки открываются в
   новой вкладке. */
/* Письмо приходит «как на бумаге»: тёмный текст, без фона. В светлой теме
   так и показываем. В тёмной — инвертируем документ целиком (чёрный текст
   становится светлым, белые подложки — тёмными), а картинки инвертируем
   обратно, чтобы фото и логотипы остались собой. Так делают почтовые
   клиенты в тёмном режиме: письмо не режет глаз белым листом, а чужие
   цвета текста не пропадают. */
const FRAME_THEME: Record<'dark' | 'light', string> = {
  dark:
    'html{background:#eef0ec;filter:invert(1) hue-rotate(180deg)}' +
    'img,video,picture,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}',
  light: 'html{background:transparent}',
};

function HtmlMail({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  const theme = useTheme();
  const themed = html.replace('<head>', `<head><style>${FRAME_THEME[theme]}</style>`);

  // Перед замером рамку ужимаем до 100 px: высота документа не меньше
  // высоты рамки, а письма часто несут «html, body { height: 100% }» — и
  // рамка, подгоняясь под собственную высоту, росла сама на себя, короткое
  // письмо разъезжалось на тысячи пикселей. Ужали, померили, вернули —
  // всё в одном кадре, глазу не видно.
  const measure = useCallback(() => {
    const el = frame.current;
    const root = el?.contentDocument?.documentElement;
    if (!el || !root) return;
    const was = el.style.height;
    el.style.height = '100px';
    const next = Math.min(Math.max(root.scrollHeight, 120), 20_000);
    el.style.height = was;
    setHeight((prev) => (Math.abs(prev - next) > 2 ? next : prev));
  }, []);

  // картинки догружаются после load — меряем ещё несколько раз и следим
  // за размером содержимого, пока письмо открыто
  useEffect(() => {
    const timers = [150, 600, 1500, 3500].map((ms) => window.setTimeout(measure, ms));
    let observer: ResizeObserver | null = null;
    const attach = window.setTimeout(() => {
      const body = frame.current?.contentDocument?.body;
      if (body && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    }, 200);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(attach);
      observer?.disconnect();
    };
  }, [themed, measure]);

  return (
    <iframe
      ref={frame}
      className="mail-frame"
      title="Письмо"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={themed}
      style={{ height }}
      onLoad={measure}
    />
  );
}

function Attachment({ uid, folder = INBOX, att }: { uid: number; folder?: string; att: MailAttachment }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const ok = await downloadCsv(attachmentPath(uid, att.index, folder), att.filename);
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
function ComposeModal({ from }: { from: string }) {
  const frame = useModalFrame();
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const markClean = useUnsavedGuard(Boolean(to || subject || text));
  const send = useMutation({ mutationFn: () => sendMail(to, subject, text) });
  // свои адресаты: директор, цех — сотруднику не нужно помнить их почту
  const contacts = useQuery({
    queryKey: ['mail', 'contacts'],
    queryFn: fetchMailContacts,
    staleTime: 5 * 60 * 1000,
  });
  const recipients = to
    .split(/[,;]/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const toggleContact = (email: string) => {
    const key = email.toLowerCase();
    if (recipients.includes(key)) {
      setTo(
        to
          .split(/[,;]/)
          .map((a) => a.trim())
          .filter((a) => a && a.toLowerCase() !== key)
          .join(', '),
      );
    } else {
      setTo(recipients.length ? `${to.replace(/[\s,;]+$/, '')}, ${email}` : email);
    }
  };

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
      eyebrow={from ? `Почта · с ящика ${from}` : 'Почта'}
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
      {(contacts.data?.contacts.length ?? 0) > 0 && (
        <div className="mail-contacts" aria-label="Свои адресаты">
          <span className="mail-contacts-label">Свои</span>
          {contacts.data!.contacts.map((c) => {
            const on = recipients.includes(c.email.toLowerCase());
            return (
              <button
                key={c.email}
                className={on ? 'mail-contact on' : 'mail-contact'}
                type="button"
                aria-pressed={on}
                title={c.email}
                onClick={() => toggleContact(c.email)}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
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
