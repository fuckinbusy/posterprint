/* Вход: список профилей, вход сотрудника и администратора, проверка токена.

   Запросы входа идут со skipAuthHandler: 401 здесь значит «неверный пароль»,
   а не «сессия истекла», и выкидывать человека на экран входа с которого он
   и не уходил — бессмысленно. */

import { request } from './client';
import type { LoginResponse, MeResponse, PermissionGroupsResponse, ProfilesResponse } from '@/types/api';

export const fetchProfiles = (): Promise<ProfilesResponse> =>
  request<ProfilesResponse>('/auth/profiles', { skipAuthHandler: true });

export const loginAdmin = (password: string): Promise<LoginResponse> =>
  request<LoginResponse>('/auth/admin', {
    method: 'POST',
    body: { password },
    skipAuthHandler: true,
  });

export const loginEmployee = (employeeId: number, password: string): Promise<LoginResponse> =>
  request<LoginResponse>('/auth/employee', {
    method: 'POST',
    body: { employee_id: employeeId, password },
    skipAuthHandler: true,
  });

export const fetchMe = (): Promise<MeResponse> =>
  request<MeResponse>('/auth/me', { skipAuthHandler: true });

/** Справочник прав с названиями — страница профиля показывает по нему,
 *  что разрешено. Доступен любому вошедшему. */
export const fetchPermissionGroups = (): Promise<PermissionGroupsResponse> =>
  request<PermissionGroupsResponse>('/auth/permissions');
