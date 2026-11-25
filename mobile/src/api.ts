import {openEventStream} from './sse';
import type {StreamEnd, StreamHandle} from './sse';

export const DEFAULT_API_URL = 'https://vamp.new.litewms.ru';

/** Состояние связи с сервером по итогам последнего запроса. */
export type LinkState = 'ok' | 'network' | 'timeout';
export const NETWORK_MESSAGE = 'Нет связи с сервером';
export const TIMEOUT_MESSAGE = 'Сервер не отвечает';

export type Role = 'admin' | 'user';
export type Account = {name: string; role: Role};
export type SessionUser = {email: string; role: Role; accounts: Account[]};
export type LoginResult = {token: string; expires_at: string; user: SessionUser};

export type KeyRecord = {
  id: number;
  user_name: string;
  key_name: string;
  reason: 'created' | 'reissued' | 'resent' | string;
  issued_by: string | null;
  issued_at: string;
};

export type AppNotification = {
  id: number;
  user_name: string;
  key_id: number | null;
  kind: 'key' | 'alert' | 'info' | string;
  title: string;
  email_sent_at: string | null;
  push_sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
};

/** Ключ пользователя: link - строка vpn:// (в приложении называется «ключ (токен)»), conf - для QR. */
export type KeyToken = {name: string; link: string; conf?: string | null};

export type ManagedUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
};

export type UserEvent = {
  id: number;
  name: string;
  event: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  created_at: string;
};

export type StatPoint = {ts: string; value: number};

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  get retryAfter(): number | undefined {
    const value = this.extra.retry_after;
    return typeof value === 'number' ? value : undefined;
  }

  get attemptsLeft(): number | undefined {
    const value = this.extra.attempts_left;
    return typeof value === 'number' ? value : undefined;
  }
}

/** Приводит введённый адрес к виду https://host[:port][/path] или возвращает null. */
export function normalizeBaseUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) {
    return null;
  }
  if (!/^https?:\/\//i.test(value)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      return null; // другая схема (ftp:// и т. п.)
    }
    value = `https://${value}`;
  }
  value = value.replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i.test(value)) {
    return null;
  }
  return value;
}

type Options = {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
  /** Вызывается после каждого запроса: ответ получен (даже с ошибкой) или связи нет. */
  onLink?: (state: LinkState) => void;
  fetchImpl?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
};

export type NotificationStreamHandlers = {
  onOpen?: () => void;
  onEvent: (event: string) => void;
  onEnd: (end: StreamEnd) => void;
};

type RequestOptions = {body?: unknown; auth?: boolean; timeoutMs?: number};

const DEFAULT_TIMEOUT_MS = 20000;
const CONTROL_TIMEOUT_MS = 440000; // сервер ждёт команду до 420 с

export class ApiClient {
  private baseUrl: string;
  private getToken: () => string | null;
  private onUnauthorized?: () => void;
  private onLink?: (state: LinkState) => void;
  private fetchImpl?: typeof fetch;
  private xhrFactory?: () => XMLHttpRequest;

  constructor(options: Options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getToken = options.getToken;
    this.onUnauthorized = options.onUnauthorized;
    this.onLink = options.onLink;
    this.fetchImpl = options.fetchImpl;
    this.xhrFactory = options.xhrFactory;
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth !== false;
    const headers: Record<string, string> = {Accept: 'application/json'};
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth) {
      const token = this.getToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      const doFetch = this.fetchImpl ?? ((input, init) => fetch(input, init));
      response = await doFetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      this.onLink?.(aborted ? 'timeout' : 'network');
      throw new ApiError(
        0,
        aborted ? 'timeout' : 'network',
        aborted ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
      );
    } finally {
      clearTimeout(timer);
    }

    // Шлюз (Caddy) отвечает 502–504, когда сам API не работает: для человека это «сервер не отвечает».
    const gateway = response.status >= 502 && response.status <= 504;
    this.onLink?.(gateway ? 'timeout' : 'ok');

    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const extra = {...(data ?? {})};
      const header = response.headers?.get?.('Retry-After');
      if (header && extra.retry_after === undefined && Number.isFinite(Number(header))) {
        extra.retry_after = Number(header);
      }
      const validation = Array.isArray(extra.detail);
      const code = typeof extra.error === 'string' ? extra.error : validation ? 'validation' : `http_${response.status}`;
      const message =
        typeof extra.message === 'string'
          ? extra.message
          : validation
          ? 'Неверные данные'
          : gateway
          ? TIMEOUT_MESSAGE
          : `Ошибка ${response.status}`;
      if (response.status === 401 && auth && code === 'unauthorized') {
        this.onUnauthorized?.();
      }
      throw new ApiError(response.status, code, message, extra);
    }

    if (data === null && text) {
      throw new ApiError(response.status, 'bad_response', 'Сервер вернул непонятный ответ');
    }
    return (data ?? {}) as T;
  }

  health() {
    return this.request<{ok: boolean}>('GET', '/health', {auth: false, timeoutMs: 8000});
  }

  requestCode(email: string) {
    return this.request<{ok: boolean}>('POST', '/v1/auth/request', {auth: false, body: {email}});
  }

  verify(email: string, code: string, device?: {platform: 'android' | 'ios'; name?: string; push_token?: string}) {
    return this.request<LoginResult>('POST', '/v1/auth/verify', {auth: false, body: {email, code, device}});
  }

  logout() {
    return this.request<{ok: boolean}>('POST', '/v1/auth/logout');
  }

  me() {
    return this.request<SessionUser>('GET', '/v1/me');
  }

  registerDevice(device: {platform: 'android' | 'ios'; name?: string; push_token: string}) {
    return this.request<{id: number}>('POST', '/v1/devices', {body: device});
  }

  status() {
    return this.request<{text: string}>('GET', '/v1/status');
  }

  server() {
    return this.request<{text: string}>('GET', '/v1/server');
  }

  rotate(force: boolean) {
    return this.request<{text: string}>('POST', '/v1/control/rotate', {body: {force}, timeoutMs: CONTROL_TIMEOUT_MS});
  }

  reboot(hard: boolean) {
    return this.request<{text: string}>('POST', '/v1/control/reboot', {body: {hard}, timeoutMs: CONTROL_TIMEOUT_MS});
  }

  emergency(mode: 'on' | 'off' | 'status') {
    return this.request<{text: string}>('POST', '/v1/control/emergency', {body: {mode}});
  }

  stats(metric = 'users_online', hours = 24) {
    return this.request<{metric: string; points: StatPoint[]}>(
      'GET',
      `/v1/stats?metric=${encodeURIComponent(metric)}&hours=${hours}`,
    );
  }

  keys(all = false) {
    return this.request<{keys: KeyRecord[]}>('GET', `/v1/keys${all ? '?all=true' : ''}`);
  }

  keyLink(name: string, notificationId?: number) {
    const query = notificationId ? `?notification_id=${notificationId}` : '';
    return this.request<KeyToken>('POST', `/v1/keys/${encodeURIComponent(name)}/link${query}`);
  }

  /** Разослать ключ всем заново (суперадмин). Сервер повторяет неушедшие письма сам, поэтому ждём долго. */
  adminResendAll() {
    return this.request<{ok: boolean; summary: string}>('POST', '/v1/admin/keys/resend-all', {timeoutMs: 300000});
  }

  /** Кому и когда ушёл ключ, у кого отправка не удалась (суперадмин). */
  adminMailStatus() {
    return this.request<{ok: boolean; text: string}>('GET', '/v1/admin/mail-status', {timeoutMs: 30000});
  }

  keyResend(name: string) {
    return this.request<{ok: boolean}>('POST', `/v1/keys/${encodeURIComponent(name)}/resend`, {timeoutMs: 60000});
  }

  keyReissue(name: string) {
    return this.request<{key_id: number; notification_id: number}>(
      'POST',
      `/v1/keys/${encodeURIComponent(name)}/reissue`,
      {timeoutMs: 90000},
    );
  }

  notifications() {
    return this.request<{notifications: AppNotification[]}>('GET', '/v1/notifications');
  }

  /** Живой поток уведомлений (SSE): сервер шлёт `changed`, когда список изменился. Закрывается через close(). */
  notificationStream(handlers: NotificationStreamHandlers): StreamHandle {
    const token = this.getToken();
    return openEventStream({
      url: `${this.baseUrl}/v1/notifications/stream`,
      headers: token ? {Authorization: `Bearer ${token}`} : {},
      onOpen: handlers.onOpen,
      onEvent: event => handlers.onEvent(event),
      onEnd: handlers.onEnd,
      xhrFactory: this.xhrFactory,
    });
  }

  markDelivered(id: number) {
    return this.request<{ok: boolean}>('POST', `/v1/notifications/${id}/delivered`);
  }

  markRead(id: number) {
    return this.request<{ok: boolean}>('POST', `/v1/notifications/${id}/read`);
  }

  adminUsers() {
    return this.request<{users: ManagedUser[]}>('GET', '/v1/admin/users');
  }

  adminEvents(name?: string) {
    const query = name ? `?name=${encodeURIComponent(name)}` : '';
    return this.request<{events: UserEvent[]}>('GET', `/v1/admin/events${query}`);
  }

  createUser(user: {name: string; email: string; role: Role}) {
    return this.request<{id: number; note: string}>('POST', '/v1/admin/users', {body: user});
  }

  patchUser(name: string, patch: {email?: string; role?: Role; active?: boolean}) {
    return this.request<{ok: boolean}>('PATCH', `/v1/admin/users/${encodeURIComponent(name)}`, {body: patch});
  }
}
