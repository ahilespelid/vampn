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

/** Ячейка = отдельный VPN-сервер (до ~1000 клиентов). state - слово от vampn: «активна», «создаётся», «ошибка». */
export type Cell = {
  cell: number;
  name: string;
  ip: string | null;
  users: number;
  limit: number;
  handshake: string | null;
  state: string;
};

/** Кабинет Timeweb. Токен в приложение не возвращается никогда. */
export type TimewebAccount = {
  name: string;
  status: 'ok' | 'denied' | 'none' | string;
  balance: number | null;
  currency: string | null;
  default: boolean;
  message: string | null;
};

export type SpawnState = 'queued' | 'running' | 'done' | 'failed' | 'none';
export type SpawnStatus = {state: SpawnState; detail: string; log: string[]};

export type StatPoint = {ts: string; value: number};

/**
 * Статистика одного ключа. «down» - скачано (отправлено клиенту), «up» - отдано (принято от клиента), байты.
 * Учёт идёт с первого запуска сборщика на сервере: что было раньше, неизвестно.
 */
export type KeyStats = {
  name: string;
  role: Role | null;
  /** null: такого пользователя в базе нет, ключ известен только по статистике. */
  active: boolean | null;
  added_at: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  tracked_since: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  online: boolean;
  connections: number;
  up_total: number;
  down_total: number;
  up_24h: number;
  down_24h: number;
  up_7d: number;
  down_7d: number;
  up_30d: number;
  down_30d: number;
  last_client_ip: string | null;
  last_server: string | null;
  last_server_ip: string | null;
};

export type KeyStatsTotals = Pick<
  KeyStats,
  'connections' | 'up_total' | 'down_total' | 'up_24h' | 'down_24h' | 'up_7d' | 'down_7d' | 'up_30d' | 'down_30d'
> & {keys: number; online: number};

export type KeyStatsList = {generated_at: string; keys: KeyStats[]; totals: KeyStatsTotals};

/** connect - подключение, client_ip - сменился IP клиента, server_ip - сменился IP сервера, server_switch - переключили сервер. */
export type KeyEvent = {
  at: string;
  kind: 'connect' | 'client_ip' | 'server_ip' | 'server_switch' | string;
  /** null: событие всего сервера, касается всех ключей. */
  key: string | null;
  old: string | null;
  new: string | null;
  server: string | null;
  server_ip: string | null;
};

export type KeyDay = {day: string; up: number; down: number};
export type KeyClientIp = {ip: string; connects: number; last_at: string | null};
export type KeyIssue = {at: string; reason: 'created' | 'reissued' | 'resent' | string};

export type KeyStatsDetail = KeyStats & {days: KeyDay[]; client_ips: KeyClientIp[]; events: KeyEvent[]; issued: KeyIssue[]};

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
  /** Журнал обмена: вызывается в начале и в конце запросов, помеченных командой. */
  onTrace?: (event: TraceEvent) => void;
  fetchImpl?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
};

export type NotificationStreamHandlers = {
  onOpen?: () => void;
  onEvent: (event: string) => void;
  onEnd: (end: StreamEnd) => void;
};

/** Запись об обмене с сервером для журнала на экране: что ушло и что сервер ответил. */
export type TraceEvent =
  | {phase: 'start'; id: number; at: number; method: string; path: string; body?: string; command: string}
  | {phase: 'end'; id: number; ms: number; ok: boolean; status: number; response: string};

type RequestOptions = {
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  /** Команда vampn, которую сервер запустит по этому запросу. Только такие запросы попадают в журнал на экране. */
  command?: string;
};

let traceCounter = 0;
const TRACE_MAX_RESPONSE = 4000;

const DEFAULT_TIMEOUT_MS = 20000;
const CONTROL_TIMEOUT_MS = 440000; // сервер ждёт команду до 420 с

export class ApiClient {
  private baseUrl: string;
  private getToken: () => string | null;
  private onUnauthorized?: () => void;
  private onLink?: (state: LinkState) => void;
  private onTrace?: (event: TraceEvent) => void;
  private fetchImpl?: typeof fetch;
  private xhrFactory?: () => XMLHttpRequest;

  constructor(options: Options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getToken = options.getToken;
    this.onUnauthorized = options.onUnauthorized;
    this.onLink = options.onLink;
    this.onTrace = options.onTrace;
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

    const started = Date.now();
    const traceId = options.command ? ++traceCounter : 0;
    if (traceId) {
      this.onTrace?.({
        phase: 'start',
        id: traceId,
        at: started,
        method,
        path,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        command: options.command ?? '',
      });
    }
    const finish = (ok: boolean, status: number, shown: string) => {
      if (traceId) {
        this.onTrace?.({phase: 'end', id: traceId, ms: Date.now() - started, ok, status, response: shown.slice(0, TRACE_MAX_RESPONSE)});
      }
    };

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
      finish(false, 0, aborted ? 'Нет ответа: время ожидания вышло.' : 'Нет ответа: связь оборвалась.');
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

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      finish(false, response.status, 'Нет ответа: связь оборвалась на середине ответа.');
      throw error;
    }
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }
    // В журнал идёт то, что вывела команда на сервере (поле text), а при ошибке тело ответа как есть.
    finish(response.ok, response.status, data && typeof data.text === 'string' ? data.text : text);

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
    return this.request<{text: string}>('GET', '/v1/server', {command: 'vampn server'});
  }

  /** server: кабинет Timeweb (1 основной, 2 запасной), только суперадмин; без него меняется IP на активном. */
  rotate(force: boolean, server?: 1 | 2) {
    return this.request<{text: string}>('POST', '/v1/control/rotate', {
      body: server ? {force, server} : {force},
      timeoutMs: CONTROL_TIMEOUT_MS,
      command: `vampn rotate${force ? ' --force' : ''}${server ? ` ${server}` : ''}`,
    });
  }

  /** Перевести туннель на кабинет Timeweb (1 основной, 2 запасной), IP не меняется, ключи не рассылаются. Только суперадмин. */
  useServer(server: 1 | 2) {
    return this.request<{text: string}>('POST', '/v1/control/use', {
      body: {server},
      timeoutMs: CONTROL_TIMEOUT_MS,
      command: `vampn use ${server}`,
    });
  }

  reboot(hard: boolean) {
    return this.request<{text: string}>('POST', '/v1/control/reboot', {
      body: {hard},
      timeoutMs: CONTROL_TIMEOUT_MS,
      command: `vampn reboot${hard ? ' hard' : ''}`,
    });
  }

  /** Состояние аварийного канала приложение запрашивает само при каждой загрузке экрана, поэтому в журнал идут только включение и выключение. */
  emergency(mode: 'on' | 'off' | 'status') {
    return this.request<{text: string}>('POST', '/v1/control/emergency', {
      body: {mode},
      command: mode === 'status' ? undefined : `vampn emergency ${mode}`,
    });
  }

  stats(metric = 'users_online', hours = 24) {
    return this.request<{metric: string; points: StatPoint[]}>(
      'GET',
      `/v1/stats?metric=${encodeURIComponent(metric)}&hours=${hours}`,
    );
  }

  /** Статистика по ключам: свои, у суперадмина все (и удалённые). */
  keyStats() {
    return this.request<KeyStatsList>('GET', '/v1/stats/keys');
  }

  keyStatsDetail(name: string) {
    return this.request<KeyStatsDetail>('GET', `/v1/stats/keys/${encodeURIComponent(name)}`);
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
    return this.request<{ok: boolean; summary: string}>('POST', '/v1/admin/keys/resendall', {timeoutMs: 300000});
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

  // ---- суперадмин: ячейки (серверы) и аренда новых серверов в Timeweb ----

  adminCells() {
    return this.request<{cells: Cell[]}>('GET', '/v1/admin/cells', {timeoutMs: 30000});
  }

  adminAccounts() {
    return this.request<{accounts: TimewebAccount[]}>('GET', '/v1/admin/timeweb/accounts', {timeoutMs: 100000});
  }

  /** Токен уходит только в тело этого запроса: без `command`, поэтому в журнал на экране не попадает. */
  adminAddAccount(name: string, token: string) {
    return this.request<{ok: boolean; text: string}>('POST', '/v1/admin/timeweb/accounts', {body: {name, token}, timeoutMs: 60000});
  }

  adminDefaultAccount(name: string) {
    return this.request<{ok: boolean; text: string}>('POST', `/v1/admin/timeweb/accounts/${encodeURIComponent(name)}/default`);
  }

  adminDeleteAccount(name: string) {
    return this.request<{ok: boolean; text: string}>('DELETE', `/v1/admin/timeweb/accounts/${encodeURIComponent(name)}`);
  }

  /** Арендует платный сервер (Амстердам, самый дешёвый тариф, Debian) и разворачивает ячейку. Возвращается сразу: идёт в фоне. */
  adminSpawn(account?: string) {
    return this.request<{ok: boolean; text: string}>('POST', '/v1/admin/spawn', {
      body: account ? {account} : {},
      timeoutMs: 60000,
      command: 'vampn spawn',
    });
  }

  adminSpawnStatus() {
    return this.request<SpawnStatus>('GET', '/v1/admin/spawn', {timeoutMs: 30000});
  }

  adminDeleteCell(n: number) {
    return this.request<{ok: boolean; text: string}>('POST', `/v1/admin/cells/${n}/delete`, {
      body: {confirm: true},
      timeoutMs: 90000,
      command: `vampn cell-del ${n}`,
    });
  }
}
