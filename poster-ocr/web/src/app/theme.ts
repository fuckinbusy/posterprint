/* Тема оформления: тёмная (как было) и светлая.

   Хранится в браузере, не в профиле: тема — свойство экрана и освещения
   в комнате, а не человека. Применяется атрибутом data-theme на <html>,
   все цвета в CSS — переменные, которые под этим атрибутом переопределены.

   Чтобы страница не мигала тёмным при загрузке в светлой теме, тот же
   атрибут выставляет крошечный скрипт в index.html ещё до стилей.

   Переключение — плавное: где браузер умеет View Transitions, новая тема
   раскрывается кругом из точки нажатия; где не умеет — цвета перетекают
   обычным transition на полсекунды. */

import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'poster.theme';
const listeners = new Set<() => void>();

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* без памяти тема живёт до перезагрузки */
  }
  listeners.forEach((fn) => fn());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    readTheme,
  );
}

interface Origin {
  x: number;
  y: number;
}

type DocumentWithVT = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/* У кнопок, карточек и рамок есть свои transition на цвета — для наведения.
   При смене темы они срабатывали все разом (на пустой доске — 90 штук):
   круг новой темы уже прошёл, а элементы под ним ещё полсекунды доплывали
   из старых цветов, и каждый кадр раскрытия пересчитывал их стили. На время
   смены темы переходы выключены; снимаются, когда анимация закончилась. */
const SWITCHING = 'theme-switching';
/* Сколько смен идёт сейчас. При двойном нажатии первая анимация
   прерывается и завершается раньше второй — снимать класс по её концу
   нельзя, иначе вторая смена снова запустит все переходы. */
let switching = 0;

const FALLBACK_MS = 480;

/** Сменить тему, красиво. origin — откуда расходится круг (точка нажатия). */
export function setTheme(theme: Theme, origin?: Origin): void {
  if (theme === readTheme()) return;
  const doc = document as DocumentWithVT;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (doc.startViewTransition && !reduced) {
    const x = origin?.x ?? window.innerWidth - 60;
    const y = origin?.y ?? 35;
    const root = document.documentElement;
    root.style.setProperty('--vt-x', `${x}px`);
    root.style.setProperty('--vt-y', `${y}px`);
    // радиус до самого дальнего угла — круг должен накрыть весь экран
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.style.setProperty('--vt-r', `${Math.ceil(r)}px`);
    switching += 1;
    root.classList.add(SWITCHING);
    const transition = doc.startViewTransition(() => apply(theme));
    transition.finished.finally(() => {
      switching -= 1;
      if (switching === 0) root.classList.remove(SWITCHING);
    });
    return;
  }

  const root = document.documentElement;
  root.classList.add('theme-anim');
  apply(theme);
  window.setTimeout(() => root.classList.remove('theme-anim'), FALLBACK_MS);
}

export function toggleTheme(origin?: Origin): void {
  setTheme(readTheme() === 'dark' ? 'light' : 'dark', origin);
}

/** Цвета текущей темы — для содержимого, которому переменные CSS недоступны
 *  (письмо в изолированной рамке). */
export function themeColors(): { text: string; muted: string; line: string; green: string; panel: string } {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    text: read('--text', '#e9ebe6'),
    muted: read('--muted', '#969c90'),
    line: read('--line-strong', 'rgba(255,255,255,0.18)'),
    green: read('--green', '#3cc707'),
    panel: read('--panel', '#101210'),
  };
}
