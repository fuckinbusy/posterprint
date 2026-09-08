/* =========================================================
   Типы ответов сервера.

   Один источник правды на фронте: всё, что приходит из /api,
   описано здесь. Если поменялась схема на сервере (app/schemas.py,
   роутеры) — правка начинается с этого файла, дальше компилятор сам
   покажет все места, которые перестали сходиться.
   ========================================================= */

/* ---------------------------------------------------- права */
/* Список повторяет app/permissions.py. Union вместо string выбран
 * намеренно: опечатка в can('orders.pirce.view') раньше просто прятала
 * кнопку навсегда и находилась только на живом заказе. */
export type Permission =
  | 'orders.view'
  | 'orders.create'
  | 'orders.edit'
  | 'orders.status'
  | 'orders.delete'
  | 'orders.price.view'
  | 'orders.price.edit'
  | 'orders.estimate'
  | 'finance.totals'
  | 'finance.cash'
  | 'notify.orders'
  | 'mail.access'
  | 'design.view'
  | 'design.upload'
  | 'clients.view'
  | 'clients.search'
  | 'clients.list'
  | 'clients.edit'
  | 'clients.history'
  | 'metrics.view'
  | 'prices.view'
  | 'prices.edit'
  | 'staff.manage';

export interface PermissionItem {
  key: Permission;
  title: string;
  hint: string;
  group: string;
  default?: boolean;
  danger?: boolean;
}

export interface PermissionGroupsResponse {
  groups: { title: string; items: PermissionItem[] }[];
}

/* ---------------------------------------------------- уведомления */
export interface FreshOrders {
  /** самый большой id заказа на сервере — точка отсчёта для следующего опроса */
  latest_id: number;
  orders: Order[];
}

/* ---------------------------------------------------- резервные копии */
export interface BackupInfo {
  name: string;
  created_at: string | null;
  size: number;
  files: string[];
}

export interface BackupsResponse {
  dir: string;
  items: BackupInfo[];
  total: number;
  last_at: string | null;
}

export interface BackupResult extends BackupInfo {
  counts: Record<string, number>;
  snapshot: boolean;
}

export interface PermissionCatalog {
  groups: { title: string; items: PermissionItem[] }[];
  all: Permission[];
  defaults: Permission[];
}

/* ---------------------------------------------------- вход */
export type UserKind = 'admin' | 'employee' | 'guest';

export interface GateProfile {
  id: number;
  name: string;
  note: string;
  has_password: boolean;
  /** доступен ли профиль с этого компьютера */
  available: boolean;
  /** привязан ли профиль к списку устройств */
  bound: boolean;
}

export interface ProfilesResponse {
  device: { registered: boolean; name: string; named: boolean };
  employees: GateProfile[];
}

export interface LoginResponse {
  token: string;
  expires_at: number;
  name: string;
  kind: Exclude<UserKind, 'guest'>;
  permissions: Permission[];
}

export interface MeResponse {
  kind: UserKind;
  name: string;
  permissions: Permission[];
  employee_id: number | null;
  device_id: number | null;
  device_name: string;
}

/* ---------------------------------------------------- заказы */
export type OrderStatus = 'new' | 'confirmed' | 'in_work' | 'ready' | 'done' | 'cancelled';

/** hidden — у профиля нет права видеть деньги, сервер их не прислал */
export type PaymentState =
  | 'paid'
  | 'partial'
  | 'none'
  | 'refunded'
  | 'overpaid'
  | 'unset'
  | 'hidden';

export interface StatusMeta {
  key: OrderStatus;
  title: string;
  hint: string;
  color: string;
}

export type FieldType = 'select' | 'number' | 'bool' | 'text';

export type PricingRole =
  | 'none'
  | 'per_unit'
  | 'step_per_unit'
  | 'step_key'
  | 'per_sqm'
  | 'per_m'
  | 'per_length'
  | 'per_order'
  | 'multiplier'
  | 'width'
  | 'height'
  | 'length';

export type FieldSource = 'price' | 'list';
export type SizeUnit = 'мм' | 'см' | 'м';

/** Значение поля заказа. Тип зависит от FieldType поля. */
export type ParamValue = string | number | boolean | null;
export type OrderParams = Record<string, ParamValue>;

/** Поле в том виде, в каком его отдаёт /api/catalog для формы заказа:
 *  варианты уже подставлены из прайса, default приведён к типу поля. */
export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  default: ParamValue;
  source: FieldSource;
  price_group: string;
  price_item: string;
  pricing_role: PricingRole;
  unit: string;
  source_field: string;
  required: boolean;
}

export interface FormTemplate {
  key: string;
  title: string;
  short: string;
  hint: string;
  icon: string;
  quantity_label: string;
  fields: FormField[];
}

/** Реквизиты мастерской из .env — шапка квитанции. Любое поле может быть
 *  пустым: печать от этого не ломается, просто строки не будет. */
export interface ShopDetails {
  name: string;
  phone: string;
  address: string;
  note: string;
  /** data:-строка с картинкой; пусто — логотипа нет */
  logo: string;
}

/** GET/PUT /api/settings — реквизиты мастерской и оплаты. */
export interface SettingsSnapshot {
  values: Record<string, string>;
  /** откуда взято каждое значение: из базы, из .env или пусто */
  sources: Record<string, 'db' | 'env' | 'empty'>;
  /** секреты (пароль почты) обратно не приходят — только задан ли */
  secrets: Record<string, boolean>;
  shop: ShopDetails;
  problems: string[];
  hints: string[];
  qr_ready: boolean;
}

/** позиция раздела «Услуги», которую можно добавить к любому заказу */
export interface ExtraOption {
  key: string;
  title: string;
  price: number;
  unit: string;
}

/** доп. услуга в заказе: что выбрали и сколько раз */
export interface OrderExtraIn {
  key: string;
  qty: number;
}

/** то же в сохранённом заказе — со снимком названия и ставки */
export interface OrderExtra extends OrderExtraIn {
  title: string;
  rate: number;
}

export interface Catalog {
  templates: FormTemplate[];
  extras: ExtraOption[];
  shop: ShopDetails;
  statuses: StatusMeta[];
  /** из какого статуса в какие можно перейти */
  transitions: Record<OrderStatus, OrderStatus[]>;
  /** куда ведёт стрелка «дальше» на карточке */
  forward: Partial<Record<OrderStatus, OrderStatus>>;
}

export interface OrderEvent {
  id: number;
  kind: 'created' | 'status' | 'edited' | 'note' | 'design' | string;
  text: string;
  author: string;
  created_at: string;
}

export interface Order {
  id: number;
  number: string;
  template_key: string;
  status: OrderStatus;
  title: string;
  client_id: number | null;
  client_name: string;
  client_phone: string;
  client_contact: string;
  quantity: number;
  params: OrderParams;
  extras: OrderExtra[];
  price: number;
  prepaid: number;
  refunded: boolean;
  due_date: string | null;
  manager: string;
  notes: string;
  created_at: string;
  updated_at: string;
  /** короткое описание состава: «1000×700 мм · Наклейка» */
  summary: string;
  payment: PaymentState;
  /** сколько ещё должен клиент */
  debt: number;
  /** переплата: внесли больше стоимости */
  surplus: number;
  /** почему отменили; пусто, если заказ не в статусе «Отменён» */
  cancel_reason: string;
  events: OrderEvent[];
}

/** Тело POST /api/orders. */
export interface OrderCreatePayload {
  template_key: string;
  title: string;
  client_id: number | null;
  client_name: string;
  client_phone: string;
  client_contact: string;
  quantity: number;
  params: OrderParams;
  extras?: OrderExtraIn[];
  price?: number;
  prepaid?: number;
  refunded?: boolean;
  /** как приняли (или вернули) деньги, если внесённое изменилось;
   *  в заказе не хранится — уходит строкой в журнал кассы */
  pay_method?: PayMethod;
  due_date: string | null;
  notes: string;
}

/* ---------------------------------------------------- касса */
export type PayMethod = 'cash' | 'transfer';

export interface CashEntry {
  id: number;
  at: string;
  order_id: number;
  order_number: string;
  client_name: string;
  title: string;
  /** плюс — приняли, минус — вернули */
  amount: number;
  method: PayMethod;
  author: string;
}

export interface CashReport {
  entries: CashEntry[];
  by_method: Record<PayMethod, { in: number; out: number; net: number }>;
  by_author: { author: string; cash: number; transfer: number; total: number }[];
  total_in: number;
  total_out: number;
  total: number;
}

/* PATCH принимает те же поля — на сервере стоит extra="forbid",
 * поэтому лишний ключ вернёт 422, а не будет молча проигнорирован. */
export type OrderUpdatePayload = Partial<OrderCreatePayload>;

export interface EstimateLine {
  label: string;
  amount: number;
}

export interface Estimate {
  /** null — данных не хватило, смотрите note */
  price: number | null;
  breakdown: EstimateLine[];
  note: string;
}

/* ---------------------------------------------------- клиенты */
export interface Client {
  id: number;
  name: string;
  phone: string;
  contact: string;
  notes: string;
  created_at: string;
  updated_at: string;
  orders_count: number;
  active_count: number;
  last_order_at: string | null;
  /** null — нет права finance.totals */
  total_sum: number | null;
}

/** Общий вид постраничного ответа: клиенты, история заказов клиента. */
export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ClientsSummary {
  total: number;
  with_orders: number;
  /** приходит только с правом finance.totals */
  revenue?: number;
}

export interface ClientOrderRow {
  id: number;
  number: string;
  title: string;
  status: OrderStatus;
  /** null — нет права видеть цены */
  price: number | null;
  quantity: number;
  template_key: string;
  summary: string;
  created_at: string;
}

export type ClientSort = 'recent' | 'name' | 'orders' | 'sum';

export interface ClientUpdatePayload {
  name?: string;
  phone?: string;
  contact?: string;
  notes?: string;
}

/* ---------------------------------------------------- прайс */
export type PriceGroupKind = 'money' | 'factor';

export interface PriceItem {
  id: number;
  group_key: string;
  item_key: string;
  title: string;
  value: number;
  /** за что берётся цена: ₽/шт, ₽/м², ₽/пог.м.
   *  Живёт у позиции, а не у раздела — в одном разделе бывают разные */
  unit: string;
  /** виды работ, которые ссылаются на позицию поимённо: удалять нельзя,
   *  иначе их расчёт молча потеряет строку */
  used_by: string[];
  active: boolean;
  note: string;
  updated_at: string;
  updated_by: string;
}

export interface PriceGroup {
  /** null у «осиротевших» позиций: раздел удалён, строки остались */
  id: number | null;
  key: string;
  title: string;
  hint: string;
  /** ключ раздела-родителя; пусто — раздел верхнего уровня.
   *  Уровня всего два: у родителя своего родителя быть не может */
  parent_key: string;
  unit: string;
  kind: PriceGroupKind;
  icon: string;
  active: boolean;
  /** системный раздел — удалить нельзя */
  system: boolean;
  /** на раздел ссылаются поля видов работ — удалить нельзя */
  in_use: boolean;
  /** какие именно виды работ его держат — чтобы было понятно, что править */
  used_by: string[];
  items: PriceItem[];
}

export interface PricesResponse {
  groups: PriceGroup[];
}

export interface PriceGroupPayload {
  title: string;
  hint: string;
  unit: string;
  kind: PriceGroupKind;
  parent_key?: string;
  icon?: string;
  active?: boolean;
}

export interface PriceItemCreatePayload {
  group_key: string;
  item_key: string;
  title?: string;
  value: number;
  /** не передали — сервер возьмёт единицу раздела */
  unit?: string;
  note?: string;
}

export interface PriceItemUpdatePayload {
  title?: string;
  value?: number;
  unit?: string;
  active?: boolean;
  note?: string;
}

/* ---------------------------------------------------- виды работ */
/** Поле вида работ в «сыром» виде — так его хранит и принимает сервер.
 *  Отличается от FormField: варианты не подставлены, default_value — строка. */
export interface WorkField {
  key: string;
  label: string;
  type: FieldType;
  source: FieldSource;
  price_group: string;
  options: string[];
  default_value: string;
  pricing_role: PricingRole;
  price_item: string;
  unit: string;
  source_field: string;
  required: boolean;
}

export interface WorkFieldOut extends WorkField {
  id: number;
}

export interface WorkTemplate {
  id: number;
  key: string;
  title: string;
  short: string;
  hint: string;
  icon: string;
  quantity_label: string;
  active: boolean;
  sort_order: number;
  fields: WorkFieldOut[];
  orders_count: number;
}

/** Тело POST/PATCH /api/templates. */
export interface WorkTemplatePayload {
  title: string;
  short: string;
  hint: string;
  icon: string;
  quantity_label: string;
  active: boolean;
  fields: WorkField[];
}

export interface TemplateMeta {
  field_types: { key: FieldType; title: string; hint: string }[];
  roles: { key: PricingRole; title: string; hint: string }[];
  icons: string[];
}

export interface WorkPreviewPayload {
  quantity: number;
  params: OrderParams;
  fields: WorkField[];
}

/* ---------------------------------------------------- сотрудники */
export type AccessMode = 'any' | 'devices';

export interface Employee {
  id: number;
  name: string;
  permissions: Permission[];
  active: boolean;
  note: string;
  access_mode: AccessMode;
  allowed_devices: number[];
  has_password: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

export interface EmployeePayload {
  name: string;
  note: string;
  permissions: Permission[];
  access_mode: AccessMode;
  allowed_devices: number[];
  /** пустая строка = снять пароль; поле не передано = оставить прежний */
  password?: string;
  active?: boolean;
}

/* ---------------------------------------------------- устройства */
export interface Device {
  id: number;
  name: string;
  note: string;
  last_ip: string;
  first_ip: string;
  browser: string;
  display_name: string;
  /** имена профилей, привязанных к устройству */
  bound_to: string[];
  is_current: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

/* ---------------------------------------------------- макеты */
/** Ответ GET /api/orders/{id}/payment — то, что показывают клиенту у стойки. */
export interface OrderPayment {
  /** есть ли что показать вообще: QR, карта или телефон */
  available: boolean;
  /** 'gost' — платёж по реквизитам, 'link' — ссылка на перевод из банка */
  mode: 'gost' | 'link';
  /** data:-ссылка с картинкой QR; пусто — реквизиты для него не заполнены */
  qr: string;
  amount: number;
  /** попала ли сумма внутрь кода — иначе её называет сотрудник */
  amount_in_qr: boolean;
  purpose: string;
  recipient: string;
  requisites: { label: string; value: string }[];
  note: string;
  /** что недонастроено; приходит только администратору */
  problems: string[];
  /** не ошибки, но стоит знать; тоже только администратору */
  hints: string[];
}

/** Смена цены или единицы у позиции прайса. */
export interface PriceChange {
  id: number;
  field: 'value' | 'unit';
  old_value: string;
  new_value: string;
  author: string;
  created_at: string;
}

export interface DesignInfo {
  exists: boolean;
  filename: string;
  size: number;
  uploaded_at: string | null;
  has_preview: boolean;
  preview_note: string;
  can_upload: boolean;
}

export interface DesignLink {
  url: string;
  filename: string;
}

/* ---------------------------------------------------- метрики */
export interface MetricsBucket {
  label: string;
  sum: number;
}

export interface MetricsTemplateRow {
  key: string;
  title: string;
  count: number;
  sum: number;
}

export interface MetricsClientRow {
  name: string;
  count: number;
  sum: number;
}

export interface Metrics {
  period: { days: number; label: string; since: string | null };
  /** фактически полученные деньги по выданным заказам, а не сумма по прайсу */
  revenue: number;
  /** сколько не доплатили по уже выданным заказам */
  done_debt: number;
  orders_done: number;
  avg_check: number;
  created_count: number;
  cancelled_count: number;
  cancel_rate: number;
  /** null — нет ни одного выданного заказа за период */
  avg_lead_days: number | null;
  active_count: number;
  active_sum: number;
  debt: number;
  prepaid_held: number;
  overdue_count: number;
  due_today_count: number;
  no_price_count: number;
  by_template: MetricsTemplateRow[];
  top_clients: MetricsClientRow[];
  clients_total: number;
  series: MetricsBucket[];
  /** график по месяцам, а не по дням — для периодов больше квартала */
  by_month: boolean;
}
