/* Прокрутка доски вбок.

   Шесть колонок помещаются не на каждый экран, и доска скроллится
   горизонтально. Три вещи, которые делают это незаметным:

   1. Автопрокрутка при перетаскивании: карточку тянут к краю доски —
      доска едет сама, чем ближе к краю, тем быстрее. Без этого перенести
      заказ в колонку за краем нельзя вовсе: бросить некуда.
   2. Колесо мыши над шапкой колонки или между колонками крутит доску
      вбок. Внутри колонки, где есть что прокручивать, колесо работает как
      обычно — вертикально.
   3. Положение запоминается: ушёл в «Клиенты», вернулся — доска там же,
      где была. */

const EDGE = 80;        // ширина зоны у края, где начинается автопрокрутка
const MAX_SPEED = 22;   // px за кадр у самого края

let board: HTMLElement | null = null;
let speed = 0;
let frame = 0;

function tick() {
  frame = requestAnimationFrame(() => {
    if (!board || !speed) {
      frame = 0;
      return;
    }
    board.scrollLeft += speed;
    tick();
  });
}

/** Позвать на каждое движение указателя во время перетаскивания. */
export function edgeScroll(clientX: number): void {
  board = document.querySelector<HTMLElement>('.board');
  if (!board) return;
  const box = board.getBoundingClientRect();
  let next = 0;
  if (clientX < box.left + EDGE) next = -MAX_SPEED * (1 - Math.max(clientX - box.left, 0) / EDGE);
  else if (clientX > box.right - EDGE) next = MAX_SPEED * (1 - Math.max(box.right - clientX, 0) / EDGE);
  speed = Math.round(next);
  if (speed && !frame) tick();
  if (!speed) stopEdgeScroll();
}

export function stopEdgeScroll(): void {
  speed = 0;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

/* ---------------------------------------------------- колесо */
/** Колесо над доской вне прокручиваемого тела колонки — вбок. */
export function wheelSideways(e: WheelEvent): void {
  const el = e.currentTarget as HTMLElement;
  if (e.deltaX !== 0 || e.deltaY === 0 || e.shiftKey) return;   // уже горизонтальное или shift
  const body = (e.target as Element | null)?.closest<HTMLElement>('.col-body');
  if (body && body.scrollHeight > body.clientHeight + 1) return; // в колонке есть что листать
  if (el.scrollWidth <= el.clientWidth) return;                  // доска и так помещается
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
