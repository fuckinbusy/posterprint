/* Сотрудники, права и устройства — всё, что живёт в разделе «Сотрудники». */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from './client';
import { qk } from './keys';
import type { Device, Employee, EmployeePayload, PermissionCatalog } from '@/types/api';

/* ---------------------------------------------------- сотрудники */
export const fetchEmployees = (): Promise<Employee[]> => request<Employee[]>('/employees');

export const fetchPermissionCatalog = (): Promise<PermissionCatalog> =>
  request<PermissionCatalog>('/employees/permissions');

export const createEmployee = (payload: EmployeePayload): Promise<Employee> =>
  request<Employee>('/employees', { method: 'POST', body: payload });

export const updateEmployee = (
  id: number,
  payload: Partial<EmployeePayload>,
): Promise<Employee> => request<Employee>(`/employees/${id}`, { method: 'PATCH', body: payload });

export const deleteEmployee = (id: number): Promise<null> =>
  request<null>(`/employees/${id}`, { method: 'DELETE' });

/* API-ключ сотрудника — пропуск для ботов и программ. Видит и перевыпускает
 * только администратор; каждый показ записывается в журнал на сервере,
 * поэтому ключ запрашиваем по нажатию, а не вместе с профилем. */
export const fetchApiKey = (id: number): Promise<{ api_key: string }> =>
  request<{ api_key: string }>(`/employees/${id}/api-key`);

export const rotateApiKey = (id: number): Promise<{ api_key: string }> =>
  request<{ api_key: string }>(`/employees/${id}/api-key`, { method: 'POST' });

export function useEmployees(enabled = true) {
  return useQuery({ queryKey: qk.employees, queryFn: fetchEmployees, enabled });
}

export function usePermissionCatalog(enabled = true) {
  return useQuery({
    queryKey: qk.permissions,
    queryFn: fetchPermissionCatalog,
    enabled,
    staleTime: Infinity, // справочник прав зашит в коде сервера
  });
}

/* ---------------------------------------------------- устройства */
export const fetchDevices = (): Promise<Device[]> => request<Device[]>('/devices');

export const updateDevice = (id: number, name: string): Promise<Device> =>
  request<Device>(`/devices/${id}`, { method: 'PATCH', body: { name } });

export const deleteDevice = (id: number): Promise<null> =>
  request<null>(`/devices/${id}`, { method: 'DELETE' });

export function useDevices(enabled = true) {
  return useQuery({ queryKey: qk.devices, queryFn: fetchDevices, enabled });
}

/* ---------------------------------------------------- сброс кэша */
/* Профили и устройства связаны: удаление устройства чистит привязки в
 * профилях, а привязка профиля меняет колонку «привязан к» у устройства.
 * Поэтому сбрасываем всегда оба списка. */
export function useStaffMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.employees });
      qc.invalidateQueries({ queryKey: qk.devices });
    },
  });
}
