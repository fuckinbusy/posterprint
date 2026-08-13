/* Профиль сотрудника и его права.

   Права приходят с сервера при входе и лежат здесь. can('ключ') прячет
   элементы интерфейса. Это удобство, а не защита: настоящая проверка — на
   сервере, здесь мы просто не показываем то, что человеку всё равно не
   отдадут. */

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { fetchMe, loginAdmin, loginEmployee } from '@/api/auth';
import { getToken, setToken, setUnauthorizedHandler } from '@/api/client';
import type { LoginResponse, Permission, UserKind } from '@/types/api';

interface Session {
  kind: Exclude<UserKind, 'guest'>;
  name: string;
  permissions: Permission[];
}

interface AuthApi {
  /** null — профиль не выбран, показываем экран входа */
  session: Session | null;
  /** идёт проверка сохранённого токена при загрузке страницы */
  checking: boolean;
  isAdmin: boolean;
  can: (permission: Permission) => boolean;
  signInAdmin: (password: string) => Promise<void>;
  signInEmployee: (employeeId: number, password: string) => Promise<void>;
  signOut: (message?: string) => void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({
  children,
  onSignedOut,
}: {
  children: ReactNode;
  /** сообщить человеку, почему его выкинуло (истёкшая сессия) */
  onSignedOut?: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  const signOut = useCallback(
    (message?: string) => {
      setToken('');
      setSession(null);
      // чужие данные в кэше остаться не должны: следующий профиль может
      // иметь меньше прав, а карточки уже лежат в памяти
      qc.clear();
      if (message) onSignedOut?.(message);
    },
    [qc, onSignedOut],
  );

  // сервер ответил «нужен вход» — токен протух или сервер перезапустили
  useEffect(() => {
    setUnauthorizedHandler(() => signOut('Сессия истекла — войдите заново'));
  }, [signOut]);

  // проверка сохранённого токена при загрузке страницы
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      if (!getToken()) {
        setChecking(false);
        return;
      }
      try {
        const me = await fetchMe();
        if (cancelled) return;
        if (me.kind === 'guest') {
          setToken('');
        } else {
          setSession({ kind: me.kind, name: me.name, permissions: me.permissions });
        }
      } catch {
        // сервер недоступен или токен не годится — покажем экран выбора профиля
        if (!cancelled) setToken('');
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback(
    (data: LoginResponse) => {
      setToken(data.token);
      setSession({ kind: data.kind, name: data.name, permissions: data.permissions });
      // на случай, если в кэше остались данные прошлого профиля
      qc.clear();
    },
    [qc],
  );

  const api = useMemo<AuthApi>(
    () => ({
      session,
      checking,
      isAdmin: session?.kind === 'admin',
      can: (permission: Permission) => Boolean(session?.permissions.includes(permission)),
      signInAdmin: async (password: string) => accept(await loginAdmin(password)),
      signInEmployee: async (employeeId: number, password: string) =>
        accept(await loginEmployee(employeeId, password)),
      signOut,
    }),
    [session, checking, accept, signOut],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вызван вне AuthProvider');
  return ctx;
}

/** Короткая форма для частого случая: нужна только проверка права. */
export function useCan(): (permission: Permission) => boolean {
  return useAuth().can;
}
