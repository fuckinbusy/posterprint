/* Полоса «Сегодня» над доской и загрузка цеха на неделю.

   Утром первое, на что смотрят: что просрочено, что сдать сегодня, что
   лежит готовое и ждёт клиента. Раньше это искали глазами по колонкам.
   Нажатие на счётчик оставляет на доске только эти заказы.

   «Загрузка» — сколько заказов и квадратных метров печати приходится на
   каждый из ближайших семи дней. Нужна приёмке, чтобы называть реальный
   срок, а не «дня через два»: если на завтра уже 40 м² баннера, новый
   заказ честнее обещать на послезавтра.

   Считается по всем заказам доски, а не по отфильтрованным: фильтр по виду
   работ и поиск — про то, что смотрят сейчас, а срочность и загрузка —
   про цех целиком. */

import { useState } from 'react';

import { ClockIcon } from '@/components/Icons';
import { contributes } from '@/features/orders/dimensions';
import { dateRu, plural, todayISO } from '@/lib/format';
import type { FormField, FormTemplate, Order } from '@/types/api';

/* Три счётчика полосы плюс ячейки загрузки: день (`day:ГГГГ-ММ-ДД`),
   «позже» и «без срока». Нажатие на ячейку оставляет на доске заказы
   этого дня — так приёмка видит, чем именно занят завтрашний день. */
export type BoardFocus = 'overdue' | 'today' | 'ready' | 'later' | 'nodue' | `day:${string}`;

const isActive = (order: Order): boolean => order.status !== 'done' && order.status !== 'cancelled';

/** Попадает ли заказ под выбранный счётчик. Без выбора — все. */
export function matchesFocus(order: Order, focus: BoardFocus | null, today = todayISO()): boolean {
  if (!focus) return true;
  if (focus === 'ready') return order.status === 'ready';
  if (!isActive(order)) return false;
  if (focus === 'nodue') return !order.due_date;
  if (!order.due_date) return false;
  if (focus === 'overdue') return order.due_date < today;
  if (focus === 'today') return order.due_date === today;
  if (focus === 'later') return order.due_date > shiftDay(today, 6);
  return order.due_date === focus.slice(4);
}

/** Подпись выбранного дня для полосы, когда панель загрузки закрыта. */
export function focusLabel(focus: BoardFocus, today = todayISO()): string {
  if (focus === 'later') return 'Позже недели';
  if (focus === 'nodue') return 'Без срока';
  if (focus.startsWith('day:')) {
    const date = focus.slice(4);
    return date === shiftDay(today, 1) ? `Завтра, ${dateRu(date)}` : dateRu(date);
  }
  return '';
}

/* Площадь печати по заказу, м². Ноль — если вид работ не считается по
   площади (визитки, фрезеровка) или размеры не указаны. Правило то же,
   что у расчёта цены: первое поле-ширина и первое поле-высота, единицы
   приводятся к миллиметрам. */
const UNIT_TO_MM: Record<string, number> = { мм: 1, см: 10, м: 1000 };

function printArea(order: Order, template: FormTemplate | undefined): number {
  if (!template) return 0;
  const bySqm = template.fields.some(
    (f: FormField) => f.pricing_role === 'per_sqm' && contributes(f, order.params),
  );
  if (!bySqm) return 0;
  const dim = (role: 'width' | 'height'): number => {
    const field = template.fields.find((f) => f.pricing_role === role);
    if (!field) return 0;
    const raw = Number(order.params[field.key] ?? field.default ?? 0) || 0;
    return raw * (UNIT_TO_MM[field.unit || 'мм'] ?? 1);
  };
  return (dim('width') * dim('height')) / 1_000_000 * order.quantity;
}

function shiftDay(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const next = new Date(y, m - 1, d + days);
  const local = new Date(next.getTime() - next.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const weekday = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { weekday: 'short' });

const sqm = (value: number): string =>
  value >= 10 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toString().replace('.', ',');

interface TodayBarProps {
  orders: Order[];
  templates: FormTemplate[];
  focus: BoardFocus | null;
  onFocus: (focus: BoardFocus | null) => void;
}

export function TodayBar({ orders, templates, focus, onFocus }: TodayBarProps) {
  const [showLoad, setShowLoad] = useState(false);
  const today = todayISO();

  const counts: Record<'overdue' | 'today' | 'ready', number> = {
    overdue: orders.filter((o) => matchesFocus(o, 'overdue', today)).length,
    today: orders.filter((o) => matchesFocus(o, 'today', today)).length,
    ready: orders.filter((o) => matchesFocus(o, 'ready', today)).length,
  };

  const toggle = (next: BoardFocus) => onFocus(focus === next ? null : next);

  const pill = (key: 'overdue' | 'today' | 'ready', label: string, hot = false) => (
    <button
      className={['today-pill', focus === key ? 'on' : '', hot && counts[key] > 0 ? 'hot' : '', counts[key] === 0 ? 'zero' : '']
        .filter(Boolean)
        .join(' ')}
      type="button"
      aria-pressed={focus === key}
      title={focus === key ? 'Показать все заказы' : `Оставить на доске только: ${label.toLowerCase()}`}
      onClick={() => toggle(key)}
    >
      {label}
      <b>{counts[key]}</b>
    </button>
  );

  return (
    <div className="today-wrap">
      <div className="today-bar">
        <span className="today-label">
          <ClockIcon />
          Сегодня
        </span>
        {pill('overdue', 'Просрочено', true)}
        {pill('today', 'Сдать сегодня')}
        {pill('ready', 'К выдаче')}
        {/* выбран день из загрузки — напоминаем, что доска отфильтрована,
            даже если панель уже закрыли */}
        {focus && focusLabel(focus, today) && (
          <button className="today-pill on day" type="button" title="Показать все заказы" onClick={() => onFocus(null)}>
            {focusLabel(focus, today)}
            <b aria-hidden="true">×</b>
          </button>
        )}
        <button
          className={showLoad ? 'today-load on' : 'today-load'}
          type="button"
          aria-expanded={showLoad}
          onClick={() => setShowLoad((v) => !v)}
        >
          Загрузка цеха
          <span aria-hidden="true">{showLoad ? '▴' : '▾'}</span>
        </button>
      </div>
      {showLoad && <LoadPanel orders={orders} templates={templates} today={today} focus={focus} onFocus={onFocus} />}
    </div>
  );
}

function LoadPanel({
  orders,
  templates,
  today,
  focus,
  onFocus,
}: {
  orders: Order[];
  templates: FormTemplate[];
  today: string;
  focus: BoardFocus | null;
  onFocus: (focus: BoardFocus | null) => void;
}) {
  const byKey = new Map(templates.map((t) => [t.key, t]));
  const active = orders.filter(isActive);

  const bucket = (list: Order[]) => ({
    count: list.length,
    area: list.reduce((acc, o) => acc + printArea(o, byKey.get(o.template_key)), 0),
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDay(today, i);
    return { date, ...bucket(active.filter((o) => o.due_date === date)) };
  });
  const overdue = bucket(active.filter((o) => o.due_date && o.due_date < today));
  const noDue = bucket(active.filter((o) => !o.due_date));
  const later = bucket(active.filter((o) => o.due_date && o.due_date > days[6].date));

  // ячейка — кнопка: нажатие оставляет на доске заказы этого дня
  const cell = (key: BoardFocus, label: string, sub: string, b: { count: number; area: number }, className = '') => (
    <button
      className={['load-day', className, b.count === 0 ? 'empty' : '', focus === key ? 'on' : ''].filter(Boolean).join(' ')}
      type="button"
      key={key}
      aria-pressed={focus === key}
      disabled={b.count === 0}
      title={focus === key ? 'Показать все заказы' : `Оставить на доске только: ${label.toLowerCase()}`}
      onClick={() => onFocus(focus === key ? null : key)}
    >
      <span className="load-date">
        {label}
        <small>{sub}</small>
      </span>
      <b>{b.count ? `${b.count} ${plural(b.count, 'заказ', 'заказа', 'заказов')}` : '—'}</b>
      <span className="load-area">{b.area > 0 ? `${sqm(b.area)} м²` : ''}</span>
    </button>
  );

  return (
    <div className="load-panel" aria-label="Загрузка цеха на неделю">
      {overdue.count > 0 && cell('overdue', 'Просрочено', '', overdue, 'hot')}
      {days.map((d, i) =>
        cell(
          i === 0 ? 'today' : `day:${d.date}`,
          i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : weekday(d.date),
          dateRu(d.date),
          d,
          i === 0 ? 'today' : '',
        ),
      )}
      {later.count > 0 && cell('later', 'Позже', '', later)}
      {noDue.count > 0 && cell('nodue', 'Без срока', '', noDue, 'muted')}
      <div className="load-hint">м² — площадь печати по размерам в заказе; работы без площади считаются штуками</div>
    </div>
  );
}
