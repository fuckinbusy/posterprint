/* Личные настройки: живут в этом браузере и привязаны к профилю.

   Не на сервере, потому что они про конкретное рабочее место: планшету в
   цехе нужно, чтобы доска обновлялась сама, а у приёмки за стойкой это
   только мигание. Один и тот же сотрудник на разных компьютерах может
   хотеть разного — поэтому ключ хранения включает и имя профиля.

   Хранилище может быть недоступно (приватное окно, запрет сайту) — тогда
   настройки просто не запоминаются, всё остальное работает. */

import { useCallback, useSyncExternalStore } from 'react';

import { useAuth } from './AuthProvider';

const listeners = new Set<() => void>();

const storageKey = (profile: string, name: string) => `poster.pref.${profile || 'anon'}.${name}`;

export function readPref<T extends string>(
  profile: string,
  name: string,
  fallback: T,
  allowed: readonly T[],
): T {
  try {
    const raw = localStorage.getItem(storageKey(profile, name));
    return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(profile: string, name: string, value: string): void {
  try {
    localStorage.setItem(storageKey(profile, name), value);
  } catch {
    /* без памяти тоже работает */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // изменение из другой вкладки того же браузера
  window.addEventListener('storage', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', fn);
  };
}

/** Значение настройки текущего профиля и функция, чтобы его поменять. */
export function usePref<T extends string>(name: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const { session } = useAuth();
  const profile = session?.name ?? '';
  const value = useSyncExternalStore(subscribe, () => readPref(profile, name, fallback, allowed));
  const set = useCallback((next: T) => writePref(profile, name, next), [profile, name]);
  return [value, set];
}

/* ---------------------------------------------------- доска */
/** Через сколько секунд доска перечитывает заказы сама. 0 — только при
 *  возврате в окно, как раньше. */
export const BOARD_REFRESH = ['0', '30', '60', '120', '300'] as const;
export type BoardRefresh = (typeof BOARD_REFRESH)[number];

export const BOARD_REFRESH_LABEL: Record<BoardRefresh, string> = {
  '0': 'Только при возврате в окно',
  '30': 'Каждые 30 секунд',
  '60': 'Каждую минуту',
  '120': 'Каждые 2 минуты',
  '300': 'Каждые 5 минут',
};

/** Интервал автообновления доски в секундах; 0 — выключено. */
export function useBoardRefresh(): number {
  const [value] = usePref<BoardRefresh>('board.refresh', '0', BOARD_REFRESH);
  return Number(value);
}
