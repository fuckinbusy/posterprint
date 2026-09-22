/* Уведомления в углу экрана. */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Toast {
  id: number;
  text: string;
  error: boolean;
}

interface ToastApi {
  /** Обычное сообщение об успехе. */
  toast: (text: string) => void;
  /** Ошибка — красная полоса слева. Принимает и Error, и строку. */
  toastError: (error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const LIFETIME_MS = 4000;

/** Достаёт текст из чего угодно, что прилетело в catch. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Что-то пошло не так';
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string, error: boolean) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, text, error }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), LIFETIME_MS);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast: (text: string) => push(text, false),
      toastError: (error: unknown) => push(errorText(error), true),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={t.error ? 'toast err' : 'toast'}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast вызван вне ToastProvider');
  return ctx;
}
