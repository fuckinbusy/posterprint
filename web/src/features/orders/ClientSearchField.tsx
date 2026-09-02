/* Поле с подсказками из справочника клиентов.

   Вешается и на имя, и на телефон: набрал три цифры номера — нашёлся
   постоянный клиент, не надо переписывать его данные заново.

   Важное отличие от прежнего интерфейса: сервер отдаёт постраничный ответ
   {items, total, ...}, а не голый массив. Раньше в список подставлялся весь
   объект, поэтому подсказки не появлялись никогда — всегда показывалось
   «ничего не нашлось». */

import { useEffect, useId, useRef, useState } from 'react';

import { useClientSearch } from '@/api/clients';
import { plural } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import type { Client } from '@/types/api';

interface ClientSearchFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'tel';
  /** есть ли право искать по базе; без него поле обычное */
  enabled: boolean;
  /** красная подпись под полем — что не так с введённым */
  error?: string | null;
  onChange: (value: string) => void;
  onPick: (client: Client) => void;
  /** ушли из поля: момент, когда уместно проверить и причесать введённое */
  onBlur?: () => void;
}

/** Пауза перед запросом: человек ещё печатает. */
const DEBOUNCE_MS = 250;

export function ClientSearchField({
  label,
  value,
  placeholder,
  type = 'text',
  enabled,
  error,
  onChange,
  onPick,
  onBlur,
}: ClientSearchFieldProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const blurTimer = useRef<number | undefined>(undefined);

  // запрос отстаёт от ввода на паузу
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(value.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  const search = useClientSearch(query, enabled && open);
  const items = search.data ?? [];

  useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  const choose = (client: Client) => {
    onPick(client);
    setOpen(false);
    setCursor(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // вверх из исходного положения (−1) не должно прыгать на первый пункт
      setCursor((prev) =>
        e.key === 'ArrowDown' ? Math.min(prev + 1, items.length - 1) : Math.max(prev - 1, -1),
      );
    }
    if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault();
      choose(items[cursor]);
    }
    if (e.key === 'Escape') setOpen(false);
  };

  const showDrop = enabled && open && query.length >= 2 && !search.isLoading;

  return (
    <div className="field client-search">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={error ? 'bad' : undefined}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setCursor(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // клик по подсказке успевает сработать раньше закрытия списка
          blurTimer.current = window.setTimeout(() => setOpen(false), 120);
          onBlur?.();
        }}
      />

      {error && <div className="hint bad">{error}</div>}

      {showDrop && (
        <div className="client-drop">
          {items.length === 0 ? (
            <div className="none">Ничего не нашлось — будет заведён новый клиент</div>
          ) : (
            items.map((client, i) => (
              <button
                className={i === cursor ? 'client-opt on' : 'client-opt'}
                type="button"
                key={client.id}
                onMouseDown={(e) => {
                  // не даём полю потерять фокус раньше, чем сработает выбор
                  e.preventDefault();
                  choose(client);
                }}
              >
                <b>{client.name || 'без имени'}</b>
                <span>
                  {formatPhone(client.phone) || 'без телефона'}
                  {client.orders_count ? (
                    <>
                      {' · '}
                      <em className="cnt">
                        {client.orders_count}{' '}
                        {plural(client.orders_count, 'заказ', 'заказа', 'заказов')}
                      </em>
                    </>
                  ) : (
                    ' · новый'
                  )}
                  {client.active_count ? (
                    <>
                      {' · '}
                      <em className="cnt">{client.active_count} в работе</em>
                    </>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
