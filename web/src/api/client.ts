/* =========================================================
   Обращения к серверу: один вход для всех запросов.

   Здесь и только здесь знают про токен, ключ устройства и то, как
   сервер сообщает об ошибке. Остальной код вызывает request() и
   получает либо данные, либо ApiError с человеческим текстом.
   ========================================================= */

export const API = '/api';

const TOKEN_KEY = 'poster.token';
const DEVICE_KEY_STORAGE = 'poster.device';

/* Ключ этого компьютера. Генерируется один раз и живёт в хранилище браузера —
 * по нему администратор привязывает профили к рабочим местам.
 * Прочитать настоящее «железо» (MAC, серийник диска) из браузера нельзя:
 * таких API не существует. Ключ отсекает чужие компьютеры, но человек с
 * доступом к консоли браузера может его скопировать — это защита от
 * «зашёл из дома», а не от намеренного обхода.
 *
 * Имя ключа то же, что у прежнего фронта: иначе при переходе на новый
 * интерфейс все компьютеры разом стали бы «новыми» и привязки слетели. */
export function deviceKey(): string {
  let key = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (!key) {
    key = crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY_STORAGE, key);
  }
  return key;
}

export const DEVICE_KEY = deviceKey();

/** Ошибка с текстом, который не стыдно показать сотруднику. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* ---------------------------------------------------- токен */
let token = localStorage.getItem(TOKEN_KEY) ?? '';

export const getToken = (): string => token;

export function setToken(value: string): void {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

/* Что делать, когда сервер ответил «нужен вход». Ставится один раз при
 * запуске (AuthProvider) — так слой запросов не тянет за собой React. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

/* ---------------------------------------------------- запрос */
interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** не выкидывать из профиля при 401 — для форм входа */
  skipAuthHandler?: boolean;
}

function buildHeaders(body: unknown, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('X-Device-Key', DEVICE_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // FormData сам ставит Content-Type с границей — не перебиваем
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

function prepareBody(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (body instanceof FormData) return body;
  return JSON.stringify(body);
}

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  // FastAPI отдаёт ошибки валидации списком — берём первую понятную
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    if (first?.msg) return first.msg;
  }
  if (res.status === 403) return 'Недостаточно прав для этого действия';
  if (res.status === 404) return 'Не найдено';
  if (res.status === 429) return 'Слишком много попыток — подождите минуту';
  if (res.status >= 500) return 'Ошибка на сервере. Повторите; если повторяется — к администратору';
  return 'Сервер не принял запрос';
}

/** Основной способ сходить на сервер. Бросает ApiError, если что-то не так. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipAuthHandler, headers, ...rest } = options;

  let res: Response;
  try {
    res = await fetch(API + path, {
      ...rest,
      headers: buildHeaders(body, headers),
      body: prepareBody(body),
    });
  } catch {
    // сеть не ответила: сервер не запущен, кабель выдернули, ушёл в перезагрузку
    throw new ApiError('Сервер недоступен. Проверьте, запущена ли программа.', 0);
  }

  if (res.status === 204) return null as T;

  if (!res.ok) {
    const message = await readError(res);
    if (res.status === 401 && !skipAuthHandler) {
      // токен протух или сервер перезапустили с другим ключом
      onUnauthorized?.();
      throw new ApiError('Сессия истекла — войдите заново', 401);
    }
    throw new ApiError(message, res.status);
  }

  // Ответ без тела или не-JSON (страница от прокси) — раньше выбрасывал
  // сырой SyntaxError, и в тосте было «Unexpected token <».
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('Сервер ответил не тем, что ожидалось. Обновите страницу.', res.status);
  }
}

/** Картинка превью: сервер отдаёт PNG, а не JSON.
 *  Отсутствие превью — обычное дело, поэтому вместо ошибки возвращаем null. */
export async function requestBlob(path: string): Promise<Blob | null> {
  const res = await fetch(API + path, { headers: buildHeaders(undefined) }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.blob();
}
