/* Справочники доски: виды работ, статусы, разрешённые переходы.

   Читается один раз при запуске и после правки видов работ. Кэш живёт
   долго — содержимое меняется только руками администратора. */

import { useQuery } from '@tanstack/react-query';

import { request } from './client';
import { qk } from './keys';
import type { Catalog } from '@/types/api';

export const fetchCatalog = (): Promise<Catalog> => request<Catalog>('/catalog');

export function useCatalog(enabled = true) {
  return useQuery({
    queryKey: qk.catalog,
    queryFn: fetchCatalog,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
