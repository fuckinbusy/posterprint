/* Статусы заказа и разрешённые переходы — из справочника сервера.

   Переходы ограничены на сервере (ALLOWED_TRANSITIONS в app/models.py),
   здесь их копия для интерфейса: недоступную кнопку лучше показать
   выключенной, чем дать нажать и получить отказ. */

import { useMemo } from 'react';

import { useCatalog } from '@/api/catalog';
import type { OrderStatus, StatusMeta } from '@/types/api';

export interface StatusHelpers {
  statuses: StatusMeta[];
  title: (key: OrderStatus) => string;
  color: (key: OrderStatus) => string;
  /** в какие статусы можно уйти из данного */
  allowedFrom: (key: OrderStatus) => OrderStatus[];
  /** куда ведёт стрелка «дальше» на карточке; null — дальше некуда */
  forward: (key: OrderStatus) => OrderStatus | null;
}

export function useStatuses(): StatusHelpers {
  const { data } = useCatalog();

  return useMemo(() => {
    const statuses = data?.statuses ?? [];
    const byKey = new Map(statuses.map((s) => [s.key, s]));

    return {
      statuses,
      title: (key) => byKey.get(key)?.title ?? key,
      color: (key) => byKey.get(key)?.color ?? '#fff',
      allowedFrom: (key) => data?.transitions?.[key] ?? [],
      forward: (key) => data?.forward?.[key] ?? null,
    };
  }, [data]);
}
