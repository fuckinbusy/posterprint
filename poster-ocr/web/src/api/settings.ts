/* Настройки: реквизиты мастерской и оплаты. Правит владелец, читает
   квитанция и экран «Куда платить». */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from './client';
import { qk } from './keys';
import type { SettingsSnapshot } from '@/types/api';

export const fetchSettings = (): Promise<SettingsSnapshot> => request<SettingsSnapshot>('/settings');

export const saveSettings = (values: Record<string, string>): Promise<SettingsSnapshot> =>
  request<SettingsSnapshot>('/settings', { method: 'PUT', body: { values } });

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: fetchSettings });
}

export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveSettings,
    onSuccess: (data) => {
      client.setQueryData(qk.settings, data);
      // реквизиты мастерской приезжают вместе с каталогом — шапка квитанции
      // должна обновиться без перезагрузки
      void client.invalidateQueries({ queryKey: qk.catalog });
      // а платёжные — в окне «куда платить»
      void client.invalidateQueries({ queryKey: ['payment'] });
    },
  });
}
