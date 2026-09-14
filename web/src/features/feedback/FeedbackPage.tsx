/* Раздел «Обратная связь»: сотрудник пишет разработчику прямо из системы.

   Зачем в интерфейсе. «Тут не сохраняется» и «а можно, чтобы…» иначе живут
   в устных пересказах и теряются. Здесь у сообщения есть вид (ошибка, идея,
   вопрос), раздел, где это случилось, и автор; разработчик отвечает в том же
   месте, и автор видит ответ в своём списке.

   Куда уходит — решает сервер (.env): в базу всегда, письмом и на вебхук —
   если настроено. Форма честно показывает, дойдёт ли сразу. */

import { useState } from 'react';
import type { FormEvent } from 'react';

import {
  useDeleteFeedback,
  useFeedbackList,
  useFeedbackTargets,
  useSendFeedback,
  useUpdateFeedback,
} from '@/api/feedback';
import { useAuth, useCan } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { Empty, Field, Loading, PageHead } from '@/components/ui';
import { dtRu, plural } from '@/lib/format';
import type { Feedback, FeedbackKind, FeedbackStatus } from '@/types/api';

const KINDS: { key: FeedbackKind; label: string; hint: string }[] = [
  { key: 'bug', label: 'Ошибка', hint: 'что-то работает не так, как должно' },
  { key: 'idea', label: 'Идея', hint: 'чего не хватает или что сделать удобнее' },
  { key: 'question', label: 'Вопрос', hint: 'непонятно, как пользоваться' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label])) as Record<FeedbackKind, string>;

const STATUSES: { key: FeedbackStatus; label: string }[] = [
  { key: 'new', label: 'Новое' },
  { key: 'seen', label: 'Прочитано' },
  { key: 'done', label: 'Сделано' },
  { key: 'declined', label: 'Не будет' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label])) as Record<
  FeedbackStatus,
  string
>;

/** Раздел, откуда человек пришёл писать: последний открытый путь. */
function lastPage(): string {
  try {
    return sessionStorage.getItem('poster.lastPage') ?? '';
  } catch {
    return '';
  }
}

export function FeedbackPage() {
  const can = useCan();
  const developer = can('staff.manage');
  const { session } = useAuth();
  const list = useFeedbackList();
  const targets = useFeedbackTargets();
  const { toast, toastError } = useToast();

  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const send = useSendFeedback();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3 || text.trim().length < 10) {
      toast('Напишите заголовок и хотя бы пару фраз — так проще разобраться');
      return;
    }
    try {
      await send.mutateAsync({ kind, title: title.trim(), text: text.trim(), page: lastPage() });
      setTitle('');
      setText('');
      toast('Отправлено. Спасибо — разработчик увидит');
    } catch (err) {
      toastError(err);
    }
  };

  const delivery = targets.data;
  const deliveryNote = !delivery
    ? ''
    : delivery.mail && delivery.webhook
      ? 'уйдёт письмом и уведомлением разработчику сразу'
      : delivery.mail
        ? 'уйдёт письмом разработчику сразу'
        : delivery.webhook
          ? 'уйдёт уведомлением разработчику сразу'
          : 'сохранится здесь; разработчик прочитает, когда откроет раздел';

  const rows = list.data ?? [];
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const shown =
    developer && filter === 'open' ? rows.filter((r) => r.status === 'new' || r.status === 'seen') : rows;
  const fresh = rows.filter((r) => r.status === 'new').length;

  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Разработчику"
          title="Обратная связь"
          sub="Нашли ошибку, не хватает кнопки, непонятно, как что-то сделать — напишите здесь. Сообщение сохраняется в системе, ответ появится в этом же разделе."
        />

        <form className="fb-form" onSubmit={(e) => void submit(e)}>
          <div className="fb-kinds" role="radiogroup" aria-label="Что это">
            {KINDS.map((k) => (
              <button
                type="button"
                key={k.key}
                role="radio"
                aria-checked={kind === k.key}
                className={kind === k.key ? `fb-kind ${k.key} active` : `fb-kind ${k.key}`}
                onClick={() => setKind(k.key)}
              >
                <b>{k.label}</b>
                <span>{k.hint}</span>
              </button>
            ))}
          </div>

          <Field label="Коротко, в чём дело">
            <input
              value={title}
              maxLength={120}
              placeholder={
                kind === 'bug'
                  ? 'Не сохраняется срок у заказа'
                  : kind === 'idea'
                    ? 'Печатать бирки сразу пачкой'
                    : 'Как перенести заказ на другого клиента?'
              }
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field
            label="Подробнее"
            hint={
              kind === 'bug'
                ? 'Что нажали, что ожидали и что получилось. Номер заказа, если он есть, — очень поможет.'
                : 'Чем подробнее, тем точнее получится сделать.'
            }
          >
            <textarea value={text} rows={6} maxLength={4000} onChange={(e) => setText(e.target.value)} />
          </Field>

          <div className="fb-send">
            <span className="fb-note">
              От: <b>{session?.name ?? '—'}</b>
              {deliveryNote && <> · {deliveryNote}</>}
            </span>
            <button className="btn btn-green" type="submit" disabled={send.isPending}>
              {send.isPending ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>
        </form>

        <div className="fb-list-head">
          <h3>
            {developer ? 'Сообщения сотрудников' : 'Мои сообщения'}
            {developer && fresh > 0 && <em className="fb-fresh">{fresh}</em>}
          </h3>
          {developer && (
            <div className="mx-tabs fb-filter">
              <button
                type="button"
                className={filter === 'open' ? 'active' : ''}
                onClick={() => setFilter('open')}
              >
                Открытые
              </button>
              <button
                type="button"
                className={filter === 'all' ? 'active' : ''}
                onClick={() => setFilter('all')}
              >
                Все · {rows.length}
              </button>
            </div>
          )}
        </div>

        {list.isLoading && !list.data && <Loading />}
        {list.data && shown.length === 0 && (
          <Empty>
            {developer
              ? filter === 'open'
                ? 'Открытых сообщений нет.'
                : 'Пока никто ничего не писал.'
              : 'Вы ещё ничего не отправляли.'}
          </Empty>
        )}
        <div className="fb-list">
          {shown.map((item) => (
            <FeedbackItem key={item.id} item={item} developer={developer} />
          ))}
        </div>
        {developer && rows.length > 0 && (
          <p className="fb-total">
            Всего {rows.length} {plural(rows.length, 'сообщение', 'сообщения', 'сообщений')}
          </p>
        )}
      </div>
    </main>
  );
}

function FeedbackItem({ item, developer }: { item: Feedback; developer: boolean }) {
  const update = useUpdateFeedback();
  const remove = useDeleteFeedback();
  const { toast, toastError } = useToast();
  const [reply, setReply] = useState(item.reply);
  const [open, setOpen] = useState(false);

  const setStatus = async (status: FeedbackStatus) => {
    try {
      await update.mutateAsync({ id: item.id, status });
    } catch (err) {
      toastError(err);
    }
  };
  const saveReply = async () => {
    try {
      await update.mutateAsync({ id: item.id, reply: reply.trim() });
      setOpen(false);
      toast('Ответ сохранён — автор увидит его в своём списке');
    } catch (err) {
      toastError(err);
    }
  };
  const del = async () => {
    try {
      await remove.mutateAsync(item.id);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <article className={`fb-item ${item.kind} st-${item.status}`}>
      <header className="fb-item-head">
        <span className={`fb-badge ${item.kind}`}>{KIND_LABEL[item.kind as FeedbackKind] ?? item.kind}</span>
        <h4>{item.title}</h4>
        <span className={`fb-status st-${item.status}`}>
          {STATUS_LABEL[item.status as FeedbackStatus] ?? item.status}
        </span>
      </header>
      <div className="fb-meta">
        <span>{item.author || '—'}</span>
        <span>{dtRu(item.created_at)}</span>
        {item.page && <span title="Раздел, откуда написали">раздел {item.page}</span>}
        {developer && item.delivered && (
          <span title="Куда ушло уведомление">доставлено: {item.delivered}</span>
        )}
      </div>
      <p className="fb-text">{item.text}</p>

      {item.reply && !open && (
        <div className="fb-reply">
          <span>Ответ разработчика</span>
          <p>{item.reply}</p>
        </div>
      )}

      {developer ? (
        <div className="fb-actions">
          <div className="fb-status-pick" role="group" aria-label="Состояние">
            {STATUSES.map((s) => (
              <button
                type="button"
                key={s.key}
                className={item.status === s.key ? 'active' : ''}
                disabled={update.isPending}
                onClick={() => void setStatus(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {open ? (
            <div className="fb-reply-form">
              <textarea
                value={reply}
                rows={3}
                maxLength={2000}
                placeholder="Что сделано или почему нет — автор увидит это у себя"
                onChange={(e) => setReply(e.target.value)}
              />
              <div className="fb-reply-btns">
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn btn-green"
                  disabled={update.isPending}
                  onClick={() => void saveReply()}
                >
                  Сохранить ответ
                </button>
              </div>
            </div>
          ) : (
            <div className="fb-reply-btns">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
                {item.reply ? 'Изменить ответ' : 'Ответить'}
              </button>
              <button
                type="button"
                className="btn btn-ghost danger"
                disabled={remove.isPending}
                onClick={() => void del()}
              >
                Удалить
              </button>
            </div>
          )}
        </div>
      ) : (
        item.status === 'new' && (
          <div className="fb-reply-btns">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={remove.isPending}
              onClick={() => void del()}
            >
              Отозвать
            </button>
          </div>
        )
      )}
    </article>
  );
}
