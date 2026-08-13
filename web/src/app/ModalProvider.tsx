/* Модальные окна — стеком.

   Зачем стек. В системе постоянно ходят вглубь: из заказа в карточку
   клиента, оттуда в другой заказ. Прежний интерфейс держал одно окно и
   заменял его содержимое, а «назад» собирал вручную — каждое место, которое
   куда-то ведёт, обязано было передать функцию возврата и заново собрать
   состояние. Заполненная форма заказа при этом теряла введённое, поэтому
   рядом жил отдельный механизм черновика.

   Здесь окна складываются стопкой и остаются смонтированными: видно только
   верхнее, остальные скрыты. Возврат — это просто снятие верхнего, а форма
   под ним всё это время цела вместе со всем, что в неё ввели. */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

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
  /** Заменить верхнее окно, не трогая стопку под ним. */
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
}

const ModalContext = createContext<ModalApi | null>(null);
const FrameContext = createContext<ModalFrame | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ModalEntry[]>([]);
  const nextId = useRef(1);

  const api = useMemo<ModalApi>(
    () => ({
      open: (content) => setStack([{ id: nextId.current++, content, backLabel: '' }]),
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
      close: () => setStack((prev) => prev.slice(0, -1)),
      closeAll: () => setStack([]),
    }),
    [],
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
}: {
  entry: ModalEntry;
  isTop: boolean;
  hasParent: boolean;
  close: () => void;
  closeAll: () => void;
}) {
  const frame = useMemo<ModalFrame>(
    () => ({ hasParent, backLabel: entry.backLabel, close, closeAll }),
    [hasParent, entry.backLabel, close, closeAll],
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
  // странице под ним, а читалка экрана останется снаружи.
  useEffect(() => {
    const node = ref.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button',
    );
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
