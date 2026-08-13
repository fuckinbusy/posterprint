/* Корень приложения: провайдеры, маршруты, общая раскладка.

   Порядок вложенности не случайный:
     QueryClient  — им пользуется AuthProvider, когда чистит кэш при выходе;
     Toast        — через него AuthProvider сообщает об истёкшей сессии;
     Confirm      — окна подтверждения рисуются поверх обычных окон;
     Auth         — дальше всё дерево знает, кто вошёл и что ему можно;
     Modal        — стек окон живёт над страницами и переживает смену раздела. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { AuthProvider } from './app/AuthProvider';
import { ConfirmProvider } from './app/ConfirmProvider';
import { ModalProvider } from './app/ModalProvider';
import { ToastProvider, useToast } from './app/ToastProvider';
import { Shell } from './app/Shell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // данные меняют несколько человек за одной доской: короткая
      // «свежесть» и перечитывание при возврате к окну держат экран
      // в актуальном виде без опроса сервера по таймеру
      staleTime: 10 * 1000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // нет смысла долбиться, если сервер сказал «нельзя» или «нет такого»
        const status = (error as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

/** Прослойка: AuthProvider сообщает об истёкшей сессии через тосты,
 *  а для этого должен оказаться внутри ToastProvider. */
function AuthLayer({ children }: { children: ReactNode }) {
  const { toastError } = useToast();
  return <AuthProvider onSignedOut={toastError}>{children}</AuthProvider>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthLayer>
            <ModalProvider>
              <HashRouter>
                <Shell />
              </HashRouter>
            </ModalProvider>
          </AuthLayer>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
