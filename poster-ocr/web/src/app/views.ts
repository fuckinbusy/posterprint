/* Разделы системы: адрес, подпись, иконка и право, без которого раздел
   не показывается. Один список — по нему строится и боковое меню,
   и защита маршрутов. */

import type { JSX } from 'react';

import {
  NavBoardIcon,
  NavClientsIcon,
  NavLogsIcon,
  NavMailIcon,
  NavMetricsIcon,
  NavPricesIcon,
  NavSettingsIcon,
  NavStaffIcon,
  NavToolsIcon,
  NavWorksIcon,
} from '@/components/Icons';
import type { Permission } from '@/types/api';

export interface ViewConfig {
  key: string;
  path: string;
  label: string;
  /** заголовок вкладки браузера */
  title: string;
  icon: (props: { className?: string }) => JSX.Element;
  /** null — раздел доступен всем, кто вошёл */
  permission: Permission | null;
}

export const VIEWS: ViewConfig[] = [
  {
    key: 'board',
    path: '/board',
    label: 'Заказы',
    title: 'ПОСТЕР · Заказы',
    icon: NavBoardIcon,
    permission: null,
  },
  {
    key: 'clients',
    path: '/clients',
    label: 'Клиенты',
    title: 'ПОСТЕР · Клиенты',
    icon: NavClientsIcon,
    permission: 'clients.list',
  },
  {
    key: 'mail',
    path: '/mail',
    label: 'Почта',
    title: 'ПОСТЕР · Почта',
    icon: NavMailIcon,
    permission: 'mail.access',
  },
  {
    key: 'prices',
    path: '/prices',
    label: 'Прайс',
    title: 'ПОСТЕР · Прайс',
    icon: NavPricesIcon,
    permission: 'prices.view',
  },
  {
    key: 'works',
    path: '/works',
    label: 'Виды работ',
    title: 'ПОСТЕР · Виды работ',
    icon: NavWorksIcon,
    permission: 'prices.view',
  },
  {
    key: 'staff',
    path: '/staff',
    label: 'Сотрудники',
    title: 'ПОСТЕР · Сотрудники',
    icon: NavStaffIcon,
    permission: 'staff.manage',
  },
  {
    key: 'metrics',
    path: '/metrics',
    label: 'Метрики',
    title: 'ПОСТЕР · Метрики',
    icon: NavMetricsIcon,
    permission: 'metrics.view',
  },
  {
    key: 'logs',
    path: '/logs',
    label: 'Журнал',
    title: 'ПОСТЕР · Журнал',
    icon: NavLogsIcon,
    permission: 'staff.manage',
  },
  {
    key: 'settings',
    path: '/settings',
    label: 'Настройки',
    title: 'ПОСТЕР · Настройки',
    icon: NavSettingsIcon,
    permission: 'staff.manage',
  },
  {
    // утилиты для цеха (план — TODO.md, раздел 16); права по каждой
    // появятся вместе с самими утилитами
    key: 'tools',
    path: '/tools',
    label: 'Инструменты',
    title: 'ПОСТЕР · Инструменты',
    icon: NavToolsIcon,
    permission: null,
  },
];

export const viewByPath = (path: string): ViewConfig | undefined =>
  VIEWS.find((v) => v.path === path);
