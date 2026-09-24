/* Мелкие повторяющиеся куски разметки.

   Ничего умного: просто чтобы не переписывать одни и те же три строки
   в каждом разделе и не разъезжаться в классах. */

import { Fragment, cloneElement, isValidElement, useId } from 'react';
import type { ReactNode } from 'react';

import { Mark } from './Icons';

/** Пустое состояние и «загружаю…» — один и тот же вид. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="mx-empty">{children}</div>;
}

export function Loading({ children = 'Загружаю…' }: { children?: ReactNode }) {
  return <div className="mx-empty">{children}</div>;
}

/** Заголовок раздела внутри окна: «◇ Клиент». */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="form-sec">
      <h3>
        <Mark /> {title}
      </h3>
      {children}
    </div>
  );
}

/** Шапка страницы-раздела. */
export function PageHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-eyebrow">
        <Mark /> {eyebrow}
      </div>
      <h1>{title}</h1>
      {sub && <p className="sub">{sub}</p>}
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Поле ввода с подписью.
 *
 *  error вытесняет hint: когда есть что исправить, подсказка о том, как
 *  поле работает, только мешает — человеку нужно одно сообщение, а не два. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  // Подпись привязываем к полю сами: htmlFor не передавал никто, и клик по
  // подписи ничего не делал, а читалка не знала, как поле называется.
  // Если внутри одно поле без id — даём ему id и связываем.
  const autoId = useId();
  const single = isValidElement<{ id?: string }>(children) ? children : null;
  const id = htmlFor ?? single?.props.id ?? (single ? autoId : undefined);
  const content = single && !single.props.id && id ? cloneElement(single, { id }) : children;
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      {content}
      {error ? <div className="hint bad">{error}</div> : hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Пара «ключ — значение» в карточке.
 *
 *  Строки склеиваются фрагментом, а не обёрткой: .kv — это grid с колонками
 *  «auto 1fr», и лишний div между ним и dt/dd сломал бы раскладку. */
export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([key, value], i) => (
        <Fragment key={i}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
