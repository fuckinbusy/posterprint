/* Подтверждение действия.

   Замена системному confirm(): своё окно в стиле интерфейса, без «127.0.0.1»
   в заголовке. Возвращает промис — вызывать через await.

   Живёт на отдельном слое поверх обычных окон: подтверждать приходится и
   при открытой форме — например, удаляя поле в конструкторе видов работ. */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface ConfirmOptions {
  title?: string;
  eyebrow?: string;
  /** Строка или несколько абзацев. Разрешена простая разметка — <b>. */
  text?: ReactNode | ReactNode[];
  /** Предупреждение жёлтым внизу. */
  note?: string;
  yes?: string;
  no?: string;
  danger?: boolean;
}

type AskConfirm = (options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<AskConfirm | null>(null);

interface PendingConfirm extends Required<Omit<ConfirmOptions, 'text' | 'note'>> {
  text: ReactNode[];
  note: string;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);

  const askConfirm = useCallback<AskConfirm>(
    (options = {}) =>
      new Promise<boolean>((resolve) => {
        const lines = Array.isArray(options.text) ? options.text : [options.text];
        setPending({
          title: options.title ?? 'Вы уверены?',
          eyebrow: options.eyebrow ?? 'Подтверждение',
          text: lines.filter(Boolean) as ReactNode[],
          note: options.note ?? '',
          yes: options.yes ?? 'Подтвердить',
          no: options.no ?? 'Отмена',
          danger: options.danger ?? false,
          resolve,
        });
      }),
    [],
  );

  const close = useCallback(
    (result: boolean) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending],
  );

  // Фокус — на безопасную кнопку. У обычного вопроса это «Да»: Enter
  // подтверждает сразу. У опасного (удалить, закрыть без сохранения) —
  // «Отмена»: раньше Enter, нажатый по инерции, удалял заказ насовсем.
  useEffect(() => {
    if (!pending) return;
    (pending.danger ? noRef : yesRef).current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // не даём Esc закрыть заодно и окно под подтверждением
        e.stopPropagation();
        close(false);
      }
      // у опасного вопроса Enter работает только как нажатие той кнопки,
      // на которой стоит фокус, — это делает сам браузер
      if (e.key === 'Enter' && !pending.danger && document.activeElement !== noRef.current) {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={askConfirm}>
      {children}
      {pending && (
        <div
          className="overlay confirm-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">{pending.eyebrow}</div>
                <h2>{pending.title}</h2>
              </div>
            </div>
            <div className="modal-body">
              {pending.text.map((line, i) => (
                <p className="confirm-text" key={i}>
                  {line}
                </p>
              ))}
              {pending.note && <div className="confirm-note">{pending.note}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" type="button" ref={noRef} onClick={() => close(false)}>
                {pending.no}
              </button>
              <div className="spacer" />
              <button
                className={pending.danger ? 'btn btn-danger' : 'btn btn-green'}
                type="button"
                ref={yesRef}
                onClick={() => close(true)}
              >
                {pending.yes}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): AskConfirm {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm вызван вне ConfirmProvider');
  return ctx;
}
