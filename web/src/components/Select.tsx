/* Выпадающий список в стилистике системы.

   Нативный <select> нельзя оформить целиком: сама кнопка красится, а
   список, который из неё выпадает, рисует операционная система — белый,
   с чужими шрифтами, посреди тёмного интерфейса. Поэтому список свой.

   Что умеет, чтобы не быть хуже нативного:
   * клавиатура — стрелки, Enter, Esc, Home/End, набор первой буквы;
   * читалка — combobox/listbox/option, aria-expanded, aria-activedescendant;
   * группы (как optgroup), отключённые пункты, подсказка у пункта;
   * открывается вверх, если внизу не помещается;
   * закрывается по клику мимо и при уходе фокуса.

   Значение — всегда строка, как у нативного select: так его удобно
   подставлять на место старого без переделки состояния. */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** мелкая подпись справа — цена, расшифровка */
  hint?: string;
  /** заголовок группы, пункты с одинаковым — под одной шапкой */
  group?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** подпись, когда значение пустое и такого пункта нет */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  title?: string;
  /** field — как поле формы; pill — таблетка (порядок на доске);
   *  compact — узкий, для строки прайса */
  variant?: 'field' | 'pill' | 'compact';
  className?: string;
}

const LIST_MAX_HEIGHT = 300;

export function Select({
  value,
  options,
  onChange,
  placeholder = '— выберите —',
  disabled,
  id,
  title,
  variant = 'field',
  className,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: '', at: 0 });

  const current = options.find((o) => o.value === value);

  // пункты в порядке показа: группы держатся вместе, порядок первого
  // появления группы сохраняется
  const ordered = useMemo(() => {
    const groups = new Map<string, SelectOption[]>();
    options.forEach((o) => {
      const key = o.group ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(o);
    });
    return [...groups.entries()];
  }, [options]);
  const flat = useMemo(() => ordered.flatMap(([, items]) => items), [ordered]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const pick = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    close();
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
  };

  const show = () => {
    if (disabled) return;
    const idx = flat.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : flat.findIndex((o) => !o.disabled));
    setOpen(true);
  };

  // вверх или вниз — решаем по месту под кнопкой, когда список уже в DOM
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const box = root.current.getBoundingClientRect();
    const need = Math.min(LIST_MAX_HEIGHT, (listRef.current?.scrollHeight ?? 0) + 8);
    setUp(window.innerHeight - box.bottom < need && box.top > need);
  }, [open]);

  // активный пункт всегда виден
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // клик мимо — закрыть
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const move = (delta: number) => {
    if (flat.length === 0) return;
    let next = active;
    for (let i = 0; i < flat.length; i += 1) {
      next = (next + delta + flat.length) % flat.length;
      if (!flat[next].disabled) break;
    }
    setActive(next);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) show();
        else move(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) show();
        else move(-1);
        return;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActive(flat.findIndex((o) => !o.disabled));
        }
        return;
      case 'End':
        if (open) {
          e.preventDefault();
          setActive(flat.length - 1);
        }
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!open) show();
        else if (active >= 0) pick(flat[active]);
        return;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation(); // иначе Esc закроет и окно под списком
          close();
        }
        return;
      case 'Tab':
        close();
        return;
      default:
        break;
    }
    // набор первых букв — как в нативном списке
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const text = (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase();
      typed.current = { text, at: now };
      const idx = flat.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(text));
      if (idx >= 0) {
        if (open) setActive(idx);
        else onChange(flat[idx].value);
      }
    }
  };

  const classes = ['sel', `sel-${variant}`];
  if (open) classes.push('open');
  if (disabled) classes.push('disabled');
  if (up) classes.push('up');
  if (className) classes.push(className);

  let counter = -1;

  return (
    <div className={classes.join(' ')} ref={root}>
      <button
        type="button"
        className="sel-btn"
        id={id}
        title={title}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={rest['aria-label']}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // фокус ушёл наружу — список больше не нужен
          if (!root.current?.contains(e.relatedTarget as Node)) close();
        }}
      >
        <span className={current ? 'sel-value' : 'sel-value empty'}>
          {current ? current.label : placeholder}
        </span>
        <i className="sel-arrow" aria-hidden="true" />
      </button>

      {open && (
        <ul className="sel-list" role="listbox" id={listId} ref={listRef} tabIndex={-1}>
          {ordered.map(([group, items]) => (
            <li key={group || '·'} role="presentation" className={group ? 'sel-section' : undefined}>
              {group && <div className="sel-group">{group}</div>}
              <ul role="presentation">
                {items.map((option) => {
                  counter += 1;
                  const index = counter;
                  const cls = ['sel-opt'];
                  if (option.value === value) cls.push('selected');
                  if (index === active) cls.push('on');
                  if (option.disabled) cls.push('disabled');
                  return (
                    <li
                      key={`${option.value}-${index}`}
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={option.value === value}
                      aria-disabled={option.disabled || undefined}
                      className={cls.join(' ')}
                      onMouseEnter={() => !option.disabled && setActive(index)}
                      onMouseDown={(e) => e.preventDefault()} // не отдаём фокус
                      onClick={() => pick(option)}
                    >
                      <span className="sel-opt-label">{option.label}</span>
                      {option.hint && <span className="sel-opt-hint">{option.hint}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {flat.length === 0 && <li className="sel-empty">Пусто</li>}
        </ul>
      )}
    </div>
  );
}
