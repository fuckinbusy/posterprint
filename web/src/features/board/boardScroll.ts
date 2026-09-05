/* Прокрутка доски вбок.

   Шесть колонок по 300 px помещаются не на каждый экран, и доска скроллится
   горизонтально. Чтобы этого не замечать:

   1. Курсор у края доски — доска едет сама, чем ближе к краю, тем быстрее.
      Начинается с небольшой задержкой (см. BoardPage), чтобы не срабатывать,
      когда мышь просто проезжает мимо. То же при перетаскивании карточки
      мышью или пальцем — без задержки: там намерение очевидно.
   2. Индикатор по краям: полупрозрачная тень со стрелкой говорит, что за
      краем ещё есть колонки, а пока доска едет — стрелка загорается.
      Сторона отдаётся подписчикам через onEdgeScroll.
   3. Колесо мыши над шапкой колонки или между колонками крутит доску вбок.
      Внутри колонки, где есть что прокручивать, колесо работает как обычно.
   4. Положение помнится: ушёл в «Клиенты», вернулся — доска там же. */

export type EdgeSide = 'left' | 'right' | null;

/** Ширина зоны у края, где начинается прокрутка. */
export const EDGE = 72;
const MAX_SPEED = 20; // px за кадр у самого края

let board: HTMLElement | null = null;
let speed = 0;
let frame = 0;
let side: EdgeSide = null;
const listeners = new Set<(side: EdgeSide) => void>();

function announce(next: EdgeSide) {
  if (next === side) return;
  side = next;
  listeners.forEach((fn) => fn(side));
}

/** Узнавать, в какую сторону доска едет сейчас (null — стоит). */
export function onEdgeScroll(fn: (side: EdgeSide) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Можно ли ещё проехать в эту сторону. Запас в 40 px: «влезло почти всё»
 *  не считается — тень ради четырёх пикселей только раздражает. */
export function canScroll(el: HTMLElement, to: 'left' | 'right'): boolean {
  if (to === 'left') return el.scrollLeft > 40;
  return el.scrollLeft + el.clientWidth < el.scrollWidth - 40;
}

function tick() {
  frame = requestAnimationFrame(() => {
    if (!board || !speed) {
      frame = 0;
      return;
    }
    const before = board.scrollLeft;
    board.scrollLeft += speed;
    // упёрлись в край — останавливаемся, стрелка гаснет
    if (board.scrollLeft === before) {
      stopEdgeScroll();
      return;
    }
    tick();
  });
}

/** Позвать на каждое движение указателя у доски. Сама решает, у края ли он. */
export function edgeScroll(clientX: number): void {
  board = document.querySelector<HTMLElement>('.board');
  if (!board) return;
  const box = board.getBoundingClientRect();
  let next = 0;
  if (clientX < box.left + EDGE) next = -MAX_SPEED * (1 - Math.max(clientX - box.left, 0) / EDGE);
  else if (clientX > box.right - EDGE) next = MAX_SPEED * (1 - Math.max(box.right - clientX, 0) / EDGE);
  // в сторону, куда ехать некуда, не едем и стрелку не зажигаем
  if (next < 0 && board.scrollLeft <= 0) next = 0;
  if (next > 0 && board.scrollLeft + board.clientWidth >= board.scrollWidth - 1) next = 0;
  speed = Math.round(next);
  if (!speed) {
    stopEdgeScroll();
    return;
  }
  announce(speed < 0 ? 'left' : 'right');
  if (!frame) tick();
}

export function stopEdgeScroll(): void {
  speed = 0;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  announce(null);
}

/* ---------------------------------------------------- колесо */
/** Колесо над доской вне прокручиваемого тела колонки — вбок. */
export function wheelSideways(e: WheelEvent): void {
  const el = e.currentTarget as HTMLElement;
  if (e.deltaX !== 0 || e.deltaY === 0 || e.shiftKey) return; // уже горизонтальное или shift
  const body = (e.target as Element | null)?.closest<HTMLElement>('.col-body');
  if (body && body.scrollHeight > body.clientHeight + 1) return; // в колонке есть что листать
  if (el.scrollWidth <= el.clientWidth) return; // доска и так помещается
  el.scrollLeft += e.deltaY;
  e.preventDefault();
}

/* ---------------------------------------------------- память положения */
let remembered = 0;

export function rememberScroll(el: HTMLElement): void {
  remembered = el.scrollLeft;
}

export function restoreScroll(el: HTMLElement): void {
  if (remembered) el.scrollLeft = remembered;
}
