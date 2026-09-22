/* Модальные окна — стеком.

   Зачем стек. В системе постоянно ходят вглубь: из заказа в карточку
   клиента, оттуда в другой заказ. Прежний интерфейс держал одно окно и
   заменял его содержимое, а «назад» собирал вручную — каждое место, которое
   куда-то ведёт, обязано было передать функцию возврата и заново собрать
   состояние. Заполненная форма заказа при этом теряла введённое, поэтому
   рядом жил отдельный механизм черновика.

   Здесь окна складываются стопкой и остаются смонтированными: видно только
   верхнее, остальные скрыты. Возврат — это просто снятие верхнего, а форма
   под ним всё это время цела вместе со всем, что в неё ввели.

   Несохранённое. Окно может объявить, что в нём есть несохранённый ввод
   (useUnsavedGuard). Тогда закрытие — крестиком, Esc, кликом мимо, кнопкой
   «Отмена» — сначала спрашивает. Раньше промах мимо окна молча стирал
   заполненную форму заказа. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { useAuth } from './AuthProvider';
import { useConfirm } from './ConfirmProvider';

interface OpenOptions {
  /** Подпись кнопки возврата к окну, которое осталось внизу. */
  backLabel?: string;
}

interface ModalEntry {
  id: number;
  content: ReactNode;
  backLabel: string;
}

interface ModalApi {
  /** Открыть окно, закрыв всё, что было открыто раньше. */
  open: (content: ReactNode) => void;
  /** Открыть поверх текущего, с возможностью вернуться назад. */
  push: (content: ReactNode, options?: OpenOptions) => void;
  /** Заменить верхнее окно, не трогая стопку под ним. Не спрашивает про
   *  несохранённое: так окна сменяют друг друга после удачного сохранения. */
  replace: (content: ReactNode) => void;
  /** Закрыть верхнее окно — вернуться к предыдущему. */
  close: () => void;
  /** Закрыть все окна разом. */
  closeAll: () => void;
}

interface ModalFrame {
  /** Есть ли куда возвращаться. */
  hasParent: boolean;
  /** Подпись кнопки возврата, например «← К заказу». */
  backLabel: string;
  close: () => void;
  closeAll: () => void;
  /** Окно сообщает, есть ли в нём несохранённое. null — снять проверку. */
  setGuard: (guard: (() => boolean) | null) => void;
}

const ModalContext = createContext<ModalApi | null>(null);
const FrameContext = createContext<ModalFrame | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ModalEntry[]>([]);
  const nextId = useRef(1);
  const askConfirm = useConfirm();
  const { session } = useAuth();

  // Текущая стопка и проверки «есть несохранённое» — в ссылках: api
  // создаётся один раз, а читать ему нужно всегда свежее.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const guards = useRef(new Map<number, () => boolean>());

  /** Можно ли закрыть окна с этими id. Спрашивает один раз, даже если
   *  несохранённое есть в нескольких — второй вопрос подряд только злит. */
  const canLeave = useCallback(
    async (ids: number[]): Promise<boolean> => {
      const dirty = ids.some((id) => guards.current.get(id)?.());
      if (!dirty) return true;
      return askConfirm({
        eyebrow: 'Несохранённые изменения',
        title: 'Закрыть без сохранения?',
        text: 'Введённое в этом окне пропадёт.',
        yes: 'Закрыть',
        no: 'Вернуться',
        danger: true,
      });
    },
    [askConfirm],
  );

  const api = useMemo<ModalApi>(
    () => ({
      open: (content) => {
        void (async () => {
          if (!(await canLeave(stackRef.current.map((e) => e.id)))) return;
          guards.current.clear();
          setStack([{ id: nextId.current++, content, backLabel: '' }]);
        })();
      },
      push: (content, options) =>
        setStack((prev) => [
          ...prev,
          { id: nextId.current++, content, backLabel: options?.backLabel ?? '← Назад' },
        ]),
      replace: (content) =>
        setStack((prev) =>
          prev.length === 0
            ? [{ id: nextId.current++, content, backLabel: '' }]
            : [
                ...prev.slice(0, -1),
                { ...prev[prev.length - 1], id: nextId.current++, content },
              ],
        ),
      close: () => {
        void (async () => {
          const top = stackRef.current[stackRef.current.length - 1];
          if (!top) return;
          if (!(await canLeave([top.id]))) return;
          guards.current.delete(top.id);
          setStack((prev) => prev.filter((e) => e.id !== top.id));
        })();
      },
      closeAll: () => {
        void (async () => {
          const ids = stackRef.current.map((e) => e.id).reverse();
          if (!(await canLeave(ids))) return;
          guards.current.clear();
          setStack([]);
        })();
      },
    }),
    [canLeave],
  );

  // Esc закрывает верхнее окно. Слушаем в фазе всплытия: подтверждение
  // висит выше и перехватывает Esc раньше, на этапе перехвата.
  useEffect(() => {
    if (stack.length === 0) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stack.length, api]);

  // Сессия кончилась — окна закрываем без вопросов: сохранить в них всё
  // равно уже нечем. Раньше форма заказа оставалась висеть поверх экрана
  // входа, и каждое «Сохранить» отвечало «сессия истекла».
  useEffect(() => {
    if (session === null) {
      guards.current.clear();
      setStack([]);
    }
  }, [session]);

  return (
    <ModalContext.Provider value={api}>
      {children}
      {stack.map((entry, index) => (
        <ModalLayer
          key={entry.id}
          entry={entry}
          isTop={index === stack.length - 1}
          hasParent={index > 0}
          close={api.close}
          closeAll={api.closeAll}
          guards={guards}
        />
      ))}
    </ModalContext.Provider>
  );
}

function ModalLayer({
  entry,
  isTop,
  hasParent,
  close,
  closeAll,
  guards,
}: {
  entry: ModalEntry;
  isTop: boolean;
  hasParent: boolean;
  close: () => void;
  closeAll: () => void;
  guards: React.MutableRefObject<Map<number, () => boolean>>;
}) {
  const frame = useMemo<ModalFrame>(
    () => ({
      hasParent,
      backLabel: entry.backLabel,
      close,
      closeAll,
      setGuard: (guard) => {
        if (guard) guards.current.set(entry.id, guard);
        else guards.current.delete(entry.id);
      },
    }),
    [hasParent, entry.backLabel, entry.id, close, closeAll, guards],
  );

  return (
    <div
      className="overlay"
      hidden={!isTop}
      onMouseDown={(e) => {
        // клик мимо окна закрывает только его само
        if (e.target === e.currentTarget) close();
      }}
    >
      <FrameContext.Provider value={frame}>{entry.content}</FrameContext.Provider>
    </div>
  );
}

export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal вызван вне ModalProvider');
  return ctx;
}

/** Сведения о текущем окне: есть ли куда вернуться и как закрыться.
 *  Доступно только внутри содержимого окна. */
export function useModalFrame(): ModalFrame {
  const ctx = useContext(FrameContext);
  if (!ctx) throw new Error('useModalFrame вызван вне окна');
  return ctx;
}

/** Окно говорит стеку: «во мне есть несохранённое».
 *
 *  Возвращает markClean — его зовут после удачного сохранения, прямо перед
 *  close/closeAll: иначе окно, которое только что сохранилось, спросило бы
 *  «закрыть без сохранения?». Отметка не сбрасывается при перерисовке. */
export function useUnsavedGuard(dirty: boolean): () => void {
  const frame = useModalFrame();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const cleanRef = useRef(false);

  useEffect(() => {
    frame.setGuard(() => !cleanRef.current && dirtyRef.current);
    return () => frame.setGuard(null);
  }, [frame]);

  return useCallback(() => {
    cleanRef.current = true;
  }, []);
}

/* ---------------------------------------------------- каркас окна */
interface ModalShellProps {
  eyebrow: ReactNode;
  title: ReactNode;
  /** широкое окно — конструктор видов работ */
  wide?: boolean;
  children: ReactNode;
  foot?: ReactNode;
}

/** Шапка, тело и подвал окна. Содержимое любого окна начинается отсюда. */
export function ModalShell({ eyebrow, title, wide, children, foot }: ModalShellProps) {
  const frame = useModalFrame();
  const ref = useRef<HTMLDivElement>(null);

  // Окно открылось — уводим фокус внутрь, иначе Tab продолжит ходить по
  // странице под ним, а читалка экрана останется снаружи. Ищем в теле, а не
  // по всему окну: первым по порядку стоит крестик «Закрыть», и Enter сразу
  // после открытия закрывал бы окно вместе с введённым.
  useEffect(() => {
    const body = ref.current?.querySelector('.modal-body');
    const node =
      body?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      ) ?? ref.current?.querySelector<HTMLElement>('.modal-foot button');
    node?.focus();
  }, []);

  return (
    <div
      className={wide ? 'modal wide' : 'modal'}
      role="dialog"
      aria-modal="true"
      ref={ref}
    >
      <div className="modal-head">
        <div>
          <div className="modal-eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
        </div>
        <button className="icon-btn" type="button" aria-label="Закрыть" onClick={frame.closeAll}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {foot && <div className="modal-foot">{foot}</div>}
    </div>
  );
}

/** Кнопка «← К заказу» в подвале. Показывается, только если есть куда идти. */
export function ModalBackButton() {
  const frame = useModalFrame();
  if (!frame.hasParent) return null;
  return (
    <button className="btn btn-ghost" type="button" onClick={frame.close}>
      {frame.backLabel}
    </button>
  );
}
