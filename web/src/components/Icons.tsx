/* Иконки. Те же контуры, что были в прежнем интерфейсе.

   Стиль (толщина линии, скругления) задан один раз в CSS правилом для svg —
   поэтому здесь только сами пути, без атрибутов оформления. */

import type { JSX, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const svg = (props: IconProps) => ({
  viewBox: '0 0 24 24',
  'aria-hidden': true as const,
  ...props,
});

/* ---------------------------------------------------- виды работ и разделы */
export const PrinterIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M6 9V3h12v6" />
    <rect x="3" y="9" width="18" height="8" rx="2" />
    <path d="M6 15h12v6H6z" />
  </svg>
);

export const DocIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5M9 13h6M9 17h4" />
  </svg>
);

export const BladeIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M8.5 16 18 4M15.5 16 6 4" />
  </svg>
);

export const RollIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M3 16c3 2 6 2 9 0s6-2 9 0" />
    <path d="M7 8h6" />
  </svg>
);

export const CardIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M6 15h5M6 11h9" />
  </svg>
);

/* ---------------------------------------------------- действия */
export const UserIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c.7-3.5 3.5-5.2 7-5.2s6.3 1.7 7 5.2" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
);

export const BellIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const ArrowIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

export const EditIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const TrashIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </svg>
);

/** Перенести в другой раздел: стрелка, уходящая в папку. */
export const MoveIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M3 7.5V5.5a1 1 0 0 1 1-1h4l1.6 2H14a1 1 0 0 1 1 1v1" />
    <path d="M3 10.5v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4" />
    <path d="M14 11h7M18 8l3 3-3 3" />
  </svg>
);

export const DeviceIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M8 20.5h8M12 16.5v4" />
  </svg>
);

export const EyeIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.7" />
  </svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M10.6 6.2A9.6 9.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3 3.8M6.3 7.9A16.7 16.7 0 0 0 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.2-1M3 3l18 18" />
  </svg>
);

export const OpenIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

export const PinIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

/* ---------------------------------------------------- макеты */
export const FileIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5" />
  </svg>
);

export const UploadIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M12 17V4M6 10l6-6 6 6" />
    <path d="M4 20h16" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M12 4v13M6 11l6 6 6-6" />
    <path d="M4 21h16" />
  </svg>
);

export const ZoomIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
  </svg>
);

/* ---------------------------------------------------- навигация в шапке */
export const PrintIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...p}>
    <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="7" />
  </svg>
);

export const NavSettingsIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const NavBoardIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <rect x="3" y="4" width="5.5" height="16" rx="1.4" />
    <rect x="9.5" y="4" width="5" height="11" rx="1.4" />
    <rect x="15.5" y="4" width="5.5" height="16" rx="1.4" />
  </svg>
);

export const NavClientsIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.5 20c.7-3.6 3.6-5.4 6.5-5.4s5.8 1.8 6.5 5.4" />
    <path d="M17 4.5a3.4 3.4 0 0 1 0 6.8" />
    <path d="M21.5 20c-.3-1.6-.9-2.9-1.8-3.8" />
  </svg>
);

export const NavPricesIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9z" />
    <circle cx="7.5" cy="7.5" r="1.2" />
  </svg>
);

export const NavWorksIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M12 3 3 8v8l9 5 9-5V8z" />
    <path d="M3 8l9 5 9-5M12 13v8" />
  </svg>
);

export const NavStaffIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20c.6-3.2 3.2-4.8 6.5-4.8s5.9 1.6 6.5 4.8" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18.5 20c-.2-1.4-.7-2.6-1.5-3.5" />
  </svg>
);

export const NavMailIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

export const NavLogsIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
  </svg>
);

export const NavMetricsIcon = (p: IconProps) => (
  <svg {...svg(p)}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

/* ---------------------------------------------------- по имени из базы */
/* Иконку вида работ и раздела прайса выбирает администратор — в базе лежит
   строка. Неизвестное имя не должно ломать страницу, поэтому запасной
   вариант принтера. */
const BY_NAME: Record<string, (p: IconProps) => JSX.Element> = {
  printer: PrinterIcon,
  doc: DocIcon,
  blade: BladeIcon,
  roll: RollIcon,
  card: CardIcon,
};

export function TemplateIcon({ name, ...rest }: IconProps & { name: string }) {
  const Component = BY_NAME[name] ?? PrinterIcon;
  return <Component {...rest} />;
}

/** Приводочный крест — фирменная метка в заголовках. */
export const Reg = () => (
  <span className="reg" aria-hidden="true">
    <i />
  </span>
);
