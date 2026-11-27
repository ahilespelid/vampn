/**
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import {Alert, Text} from 'react-native';
import ReactTestRenderer, {act} from 'react-test-renderer';

import App from '../App';

type Route = {status?: number; body: unknown};

/** Подмена XMLHttpRequest для потока уведомлений: тест сам «присылает» кадры. */
class StreamXhr {
  url = '';
  headers: Record<string, string> = {};
  status = 0;
  readyState = 0;
  responseText = '';
  timeout = -1;
  aborted = false;
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {}
  abort() {
    this.aborted = true;
  }
  push(chunk: string) {
    this.status = 200;
    this.readyState = 3;
    this.responseText += chunk;
    this.onreadystatechange?.();
    this.onprogress?.();
  }
}

let streams: StreamXhr[] = [];

const TODAY = new Date().toISOString().slice(0, 10);
const MB = 1048576;
const statsKey = {
  name: 'griga',
  role: 'user',
  active: true,
  added_at: '2026-01-01T00:00:00Z',
  removed_at: null,
  removed_reason: null,
  tracked_since: '2026-11-20T00:00:00Z',
  first_seen_at: '2026-11-20T08:00:00Z',
  last_seen_at: '2026-11-26T09:58:00Z',
  online: false,
  connections: 7,
  up_total: 5 * MB,
  down_total: 1024 * MB,
  up_24h: MB,
  down_24h: 12 * MB,
  up_7d: 2 * MB,
  down_7d: 40 * MB,
  up_30d: 5 * MB,
  down_30d: 1024 * MB,
  last_client_ip: '198.51.100.50',
  last_server: 'основной',
  last_server_ip: '203.0.113.77',
};
const statsKeys = {
  generated_at: '2026-11-26T10:00:00Z',
  keys: [statsKey],
  totals: {keys: 1, online: 0, connections: 7, up_total: 5 * MB, down_total: 1024 * MB, up_24h: MB, down_24h: 12 * MB, up_7d: 2 * MB, down_7d: 40 * MB, up_30d: 5 * MB, down_30d: 1024 * MB},
};
const statsDetail = {
  ...statsKey,
  days: [{day: TODAY, up: MB, down: 2 * MB}],
  client_ips: [
    {ip: '198.51.100.50', connects: 2, last_at: '2026-11-26T09:58:00Z'},
    {ip: '203.0.113.5', connects: 5, last_at: '2026-11-25T10:00:00Z'},
  ],
  events: [
    {at: '2026-11-26T09:50:00Z', kind: 'client_ip', key: 'griga', old: '203.0.113.5', new: '198.51.100.50', server: 'основной', server_ip: '203.0.113.77'},
    {at: '2026-11-25T08:00:00Z', kind: 'server_ip', key: null, old: '198.51.100.7', new: '203.0.113.77', server: 'основной', server_ip: '203.0.113.77'},
  ],
  issued: [{at: '2026-01-02T00:00:00Z', reason: 'created'}],
};

function mockServer(role: 'admin' | 'user') {
  streams = [];
  (globalThis as unknown as {XMLHttpRequest: unknown}).XMLHttpRequest = function () {
    const xhr = new StreamXhr();
    streams.push(xhr);
    return xhr;
  };
  const log: {path: string; method: string; auth?: string}[] = [];
  const accounts = [{name: role === 'admin' ? 'ahilespelid' : 'griga', role}];
  const routes: Record<string, Route> = {
    'POST /v1/auth/request': {body: {ok: true}},
    'POST /v1/auth/verify': {
      body: {token: 'tok-1', expires_at: '2099-01-01T00:00:00Z', user: {email: 'me@example.com', role, accounts}},
    },
    'GET /v1/me': {body: {email: 'me@example.com', role, accounts}},
    'GET /v1/status': {body: {text: 'watcher: ok'}},
    'POST /v1/control/emergency': {body: {text: 'off'}},
    'GET /v1/notifications': {body: {notifications: []}},
    'GET /v1/admin/users': {body: {users: []}},
    'GET /v1/admin/cells': {body: {cells: [{cell: 1, name: 'vampn', ip: '203.0.113.7', users: 18, limit: 1000, handshake: '40s', state: 'активна'}]}},
    'GET /v1/admin/spawn': {body: {state: 'none', detail: '', log: []}},
    'GET /v1/stats': {body: {metric: 'users_online', points: []}},
    'GET /v1/stats/keys': {body: statsKeys},
    'GET /v1/stats/keys/griga': {body: statsDetail},
  };
  (globalThis as {fetch: typeof fetch}).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace('https://vamp.new.litewms.ru', '');
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    log.push({path, method, auth: headers.Authorization});
    const route = routes[`${method} ${path.split('?')[0]}`] ?? {status: 404, body: {error: 'not_found', message: 'нет'}};
    const status = route.status ?? 200;
    return {
      ok: status < 300,
      status,
      text: async () => JSON.stringify(route.body),
      headers: {get: () => null},
    };
  }) as unknown as typeof fetch;
  return log;
}

const flush = () =>
  act(async () => {
    await new Promise<void>(resolve => {
      setImmediate(() => resolve());
    });
  });

function byTestId(renderer: ReactTestRenderer.ReactTestRenderer, id: string, prop: string) {
  const nodes = renderer.root.findAll(node => node.props.testID === id && typeof node.props[prop] === 'function');
  if (nodes.length === 0) {
    throw new Error(`нет элемента ${id}`);
  }
  return nodes[0];
}

type Json = ReactTestRenderer.ReactTestRendererJSON | ReactTestRenderer.ReactTestRendererJSON[] | null;

/** Весь видимый текст дерева (обход только по children: в props бывают циклические ссылки). */
function textOf(json: Json): string {
  if (json === null) {
    return '';
  }
  if (Array.isArray(json)) {
    return json.map(item => textOf(item)).join(' ');
  }
  return (json.children ?? [])
    .map(child => (typeof child === 'string' ? child : textOf(child)))
    .join(' ');
}

const hasTestId =(renderer: ReactTestRenderer.ReactTestRenderer, id: string) =>
  renderer.root.findAll(node => node.props.testID === id).length > 0;

async function signIn(renderer: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => {
    byTestId(renderer, 'login-email', 'onChangeText').props.onChangeText('me@example.com');
  });
  await act(async () => {
    byTestId(renderer, 'login-send', 'onPress').props.onPress();
  });
  await flush();
  await act(async () => {
    byTestId(renderer, 'login-code', 'onChangeText').props.onChangeText('4821');
  });
  await act(async () => {
    byTestId(renderer, 'login-submit', 'onPress').props.onPress();
  });
  await flush();
  await flush();
}

async function mount() {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  await flush();
  return renderer!;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.requireMock('react-native-keychain').__reset();
});

test('без сессии показывается вход по почте', async () => {
  mockServer('user');
  const renderer = await mount();
  const tree = textOf(renderer.toJSON());
  expect(tree).toContain('VAMPN');
  expect(tree).toContain('Вход только для тех, кто есть в списке');
  expect(tree).toContain('vamp.new.litewms.ru');
  expect(hasTestId(renderer, 'tab-service')).toBe(false);
  await act(async () => renderer.unmount());
});

test('почта без @ не уходит на сервер', async () => {
  const log = mockServer('user');
  const renderer = await mount();
  await act(async () => {
    byTestId(renderer, 'login-email', 'onChangeText').props.onChangeText('не почта');
  });
  await act(async () => {
    byTestId(renderer, 'login-send', 'onPress').props.onPress();
  });
  expect(log.find(call => call.path === '/v1/auth/request')).toBeUndefined();
  expect(textOf(renderer.toJSON())).toContain('Введите почту целиком');
  await act(async () => renderer.unmount());
});

test('обычный пользователь: после кода вкладки без списка людей', async () => {
  const log = mockServer('user');
  const renderer = await mount();
  await signIn(renderer);

  expect(hasTestId(renderer, 'tab-service')).toBe(true);
  expect(hasTestId(renderer, 'tab-keys')).toBe(true);
  expect(hasTestId(renderer, 'tab-stats')).toBe(true);
  expect(hasTestId(renderer, 'tab-users')).toBe(false);
  expect(textOf(renderer.toJSON())).toContain('watcher: ok');
  // списка пользователей обычный пользователь не запрашивает
  expect(log.some(call => call.path.startsWith('/v1/admin'))).toBe(false);
  // защищённые запросы идут с токеном, вход без него
  expect(log.find(call => call.path === '/v1/auth/verify')?.auth).toBeUndefined();
  expect(log.find(call => call.path === '/v1/status')?.auth).toBe('Bearer tok-1');
  await act(async () => renderer.unmount());
});

test('после входа открывается поток уведомлений с токеном; ready и changed перечитывают список', async () => {
  const log = mockServer('user');
  const renderer = await mount();
  await signIn(renderer);

  expect(streams).toHaveLength(1);
  expect(streams[0].url).toBe('https://vamp.new.litewms.ru/v1/notifications/stream');
  expect(streams[0].headers.Authorization).toBe('Bearer tok-1');
  const loads = () => log.filter(call => call.path === '/v1/notifications').length;

  const initial = loads();
  await act(async () => streams[0].push('retry: 3000\n\nevent: ready\ndata: {}\n\n'));
  await flush();
  expect(loads()).toBe(initial + 1);
  await act(async () => streams[0].push(': ping\n\nevent: changed\ndata: {}\n\n'));
  await flush();
  expect(loads()).toBe(initial + 2);

  await act(async () => renderer.unmount());
  expect(streams[0].aborted).toBe(true);
});

test('выход из сессии закрывает поток уведомлений', async () => {
  mockServer('user');
  const renderer = await mount();
  await signIn(renderer);
  await act(async () => {
    byTestId(renderer, 'tab-settings', 'onPress').props.onPress();
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await act(async () => {
    byTestId(renderer, 'logout', 'onPress').props.onPress();
  });
  // выход спрашивает подтверждение: нажимаем «Выйти» в окне
  const confirm = alert.mock.calls[0][2]?.find(button => button.text === 'Выйти');
  await act(async () => {
    confirm?.onPress?.();
  });
  await flush();
  await flush();
  alert.mockRestore();
  expect(hasTestId(renderer, 'login-email')).toBe(true);
  expect(streams[0].aborted).toBe(true);
  await act(async () => renderer.unmount());
});

test('статистика: МБ по ключу в списке, карточка ключа с IP, датами и событиями', async () => {
  const log = mockServer('user');
  const renderer = await mount();
  await signIn(renderer);
  await act(async () => {
    byTestId(renderer, 'tab-stats', 'onPress').props.onPress();
  });
  await flush();
  expect(log.some(call => call.path === '/v1/stats/keys')).toBe(true);
  let tree = textOf(renderer.toJSON());
  expect(tree).toContain('griga');
  expect(tree).toContain('1,00 ГБ'); // скачано за всё время
  expect(tree).toContain('5,00 МБ'); // отдано за всё время
  expect(tree).toContain('198.51.100.50');
  expect(tree).toContain('подключений всего');
  expect(tree).not.toContain('Учёт ключей только начался');

  await act(async () => {
    byTestId(renderer, 'stat-key-griga', 'onPress').props.onPress();
  });
  await flush();
  expect(log.some(call => call.path === '/v1/stats/keys/griga')).toBe(true);
  tree = textOf(renderer.toJSON());
  expect(tree).toContain('203.0.113.5 → 198.51.100.50'); // сменился IP клиента
  expect(tree).toContain('сменился IP сервера');
  expect(tree).toContain('для всех');
  expect(tree).toContain('С каких IP подключался');
  expect(tree).toContain('Больше всего за день');
  expect(tree).toContain('выдан');
  expect(tree).toContain('добавлен');
  await act(async () => renderer.unmount());
});

test('статистика пустая: объясняет, что учёт только начался', async () => {
  mockServer('user');
  const empty = {...statsKey, connections: 0, up_total: 0, down_total: 0, last_seen_at: null, first_seen_at: null, last_client_ip: null, last_server: null};
  const fetchMock = (globalThis as unknown as {fetch: jest.Mock}).fetch;
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/v1/stats/keys')) {
      const body = {...statsKeys, keys: [empty], totals: {...statsKeys.totals, connections: 0, up_total: 0, down_total: 0}};
      return {ok: true, status: 200, text: async () => JSON.stringify(body), headers: {get: () => null}};
    }
    return original(url, init);
  });
  const renderer = await mount();
  await signIn(renderer);
  await act(async () => {
    byTestId(renderer, 'tab-stats', 'onPress').props.onPress();
  });
  await flush();
  const tree = textOf(renderer.toJSON());
  expect(tree).toContain('Учёт ключей только начался');
  expect(tree).toContain('ещё не подключался');
  await act(async () => renderer.unmount());
});

const TWO_CABINETS = [
  'туннель      : рукопожатие 12 с назад (сервер отвечает через туннель)',
  'сервер       : 203.0.113.7:51820',
  'Timeweb (основной): статус on, IPv4 198.51.100.4 , новых IP за сутки 9 из 10; смена IP на паузе до 27.11 03:00 МСК',
  'Timeweb (запасной, активный): статус on, IPv4 203.0.113.7 , новых IP за сутки 2 из 10',
  'без связи    : 0 мин (перезагрузка с 2, смена IP с 5)',
].join('\n');

/** Подменяет статус и записывает, что приложение отправило на смену IP и переход на кабинет. */
function withCabinets(text: string) {
  const fetchMock = (globalThis as unknown as {fetch: jest.Mock}).fetch;
  const original = fetchMock.getMockImplementation()!;
  const sent: {path: string; body: string}[] = [];
  const reply = (body: unknown) => ({ok: true, status: 200, text: async () => JSON.stringify(body), headers: {get: () => null}});
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace('https://vamp.new.litewms.ru', '');
    if (path === '/v1/status') {
      return reply({text});
    }
    if (/^\/v1\/control\/(rotate|use)$/.test(path)) {
      sent.push({path, body: String(init?.body)});
      return reply({text: 'готово'});
    }
    return original(url, init);
  });
  return sent;
}

/** Состояние кнопки по testID: ищем узел, у которого оно есть (сам Btn его не хранит). */
const stateOf = (renderer: ReactTestRenderer.ReactTestRenderer, id: string) =>
  renderer.root.findAll(node => node.props.testID === id && node.props.accessibilityState)[0].props.accessibilityState;

async function pickSegment(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const tab = renderer.root.findAll(
    node => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function' && node.findAllByType(Text).some(text => text.props.children === label),
  )[0];
  if (!tab) {
    throw new Error(`нет переключателя ${label}`);
  }
  await act(async () => {
    tab.props.onPress();
  });
}

test('суперадмин выбирает кабинет: смена IP и переход уходят на выбранный, без выбора всё как раньше', async () => {
  mockServer('admin');
  const sent = withCabinets(TWO_CABINETS);
  const renderer = await mount();
  await signIn(renderer);

  let tree = textOf(renderer.toJSON());
  expect(hasTestId(renderer, 'cabinet-1')).toBe(true);
  expect(hasTestId(renderer, 'cabinet-2')).toBe(true);
  expect(tree).toContain('кабинеты Timeweb');
  expect(tree).toContain('9 из 10');
  expect(tree).toContain('смена IP на паузе до 27.11 03:00 МСК');
  expect(tree).toContain('Сменить IP-адрес');
  expect(hasTestId(renderer, 'use-cabinet')).toBe(false); // выбран «активный»: переходить некуда

  await act(async () => {
    byTestId(renderer, 'rotate', 'onPress').props.onPress();
  });
  await flush();
  expect(sent).toEqual([{path: '/v1/control/rotate', body: JSON.stringify({force: false})}]);

  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await pickSegment(renderer, 'основной'); // активный сейчас запасной
  tree = textOf(renderer.toJSON());
  expect(tree).toContain('Сменить IP: основной');
  expect(hasTestId(renderer, 'use-cabinet')).toBe(true);

  await act(async () => {
    byTestId(renderer, 'rotate', 'onPress').props.onPress();
  });
  expect(alert.mock.calls[0][0]).toContain('основной');
  expect(sent).toHaveLength(1); // пока не подтвердили, ничего не ушло
  await act(async () => {
    alert.mock.calls[0][2]?.find(button => button.text === 'Сменить')?.onPress?.();
  });
  await flush();
  expect(sent[1]).toEqual({path: '/v1/control/rotate', body: JSON.stringify({force: false, server: 1})});

  await act(async () => {
    byTestId(renderer, 'use-cabinet', 'onPress').props.onPress();
  });
  expect(alert.mock.calls[1][0]).toContain('основной');
  expect(alert.mock.calls[1][1]).toContain('Ключи не рассылаются');
  expect(sent).toHaveLength(2);
  await act(async () => {
    alert.mock.calls[1][2]?.find(button => button.text === 'Перейти')?.onPress?.();
  });
  await flush();
  expect(sent[2]).toEqual({path: '/v1/control/use', body: JSON.stringify({server: 1})});
  alert.mockRestore();
  await act(async () => renderer.unmount());
});

test('обычному пользователю кабинеты и выбор не показываются, смена IP идёт без номера', async () => {
  mockServer('user');
  const sent = withCabinets(TWO_CABINETS);
  const renderer = await mount();
  await signIn(renderer);
  expect(hasTestId(renderer, 'cabinet-1')).toBe(false);
  expect(textOf(renderer.toJSON())).not.toContain('кабинеты Timeweb');
  await act(async () => {
    byTestId(renderer, 'rotate', 'onPress').props.onPress();
  });
  await flush();
  expect(sent).toEqual([{path: '/v1/control/rotate', body: JSON.stringify({force: false})}]);
  await act(async () => renderer.unmount());
});

test('один кабинет в статусе: выбора нет', async () => {
  mockServer('admin');
  withCabinets('Timeweb (основной, активный): статус on, IPv4 203.0.113.7 , новых IP за сутки 1 из 10');
  const renderer = await mount();
  await signIn(renderer);
  expect(hasTestId(renderer, 'cabinet-1')).toBe(false);
  await act(async () => renderer.unmount());
});

test('суперадмин видит вкладку людей и запрашивает список', async () => {
  const log = mockServer('admin');
  const renderer = await mount();
  await signIn(renderer);

  expect(hasTestId(renderer, 'tab-users')).toBe(true);
  await act(async () => {
    byTestId(renderer, 'tab-users', 'onPress').props.onPress();
  });
  await flush();
  expect(log.some(call => call.path === '/v1/admin/users')).toBe(true);
  await act(async () => renderer.unmount());
});

test('сохранённая сессия переживает перезапуск, выход возвращает ко входу', async () => {
  mockServer('user');
  let renderer = await mount();
  await signIn(renderer);
  await act(async () => renderer.unmount());

  renderer = await mount();
  await flush();
  expect(hasTestId(renderer, 'tab-service')).toBe(true);

  await act(async () => {
    byTestId(renderer, 'tab-settings', 'onPress').props.onPress();
  });
  expect(hasTestId(renderer, 'logout')).toBe(true);
  await act(async () => renderer.unmount());
});

test('отказ сервера (401) сбрасывает сохранённую сессию', async () => {
  mockServer('user');
  let renderer = await mount();
  await signIn(renderer);
  await act(async () => renderer.unmount());

  (globalThis as {fetch: typeof fetch}).fetch = jest.fn(async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({error: 'unauthorized', message: 'нет'}),
    headers: {get: () => null},
  })) as unknown as typeof fetch;

  renderer = await mount();
  await flush();
  await flush();
  expect(hasTestId(renderer, 'login-email')).toBe(true);
  await act(async () => renderer.unmount());
});

test('нет сети: плашка с «повторить», сессия остаётся, после возврата связи экран загружается сам', async () => {
  mockServer('user');
  let renderer = await mount();
  await signIn(renderer);
  await act(async () => renderer.unmount());

  (globalThis as {fetch: typeof fetch}).fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;

  renderer = await mount();
  await flush();
  await flush();

  expect(hasTestId(renderer, 'tab-service')).toBe(true);
  expect(hasTestId(renderer, 'offline-bar')).toBe(true);
  const offline = textOf(renderer.toJSON());
  // о потере связи говорит одна плашка, экран свою ошибку не дублирует
  expect(offline.split('Нет связи с сервером').length - 1).toBe(1);
  expect(offline).not.toContain('watcher: ok');

  // связь вернулась: «повторить» проверяет сервер (ответ 404 тоже ответ), плашка уходит, данные грузятся заново
  mockServer('user');
  await act(async () => {
    byTestId(renderer, 'offline-retry', 'onPress').props.onPress();
  });
  await flush();
  await flush();

  expect(hasTestId(renderer, 'offline-bar')).toBe(false);
  expect(textOf(renderer.toJSON())).toContain('watcher: ok');
  await act(async () => renderer.unmount());
});

test('сервер отвечает 502: плашка «не отвечает», вход остаётся', async () => {
  mockServer('user');
  let renderer = await mount();
  await signIn(renderer);
  await act(async () => renderer.unmount());

  (globalThis as {fetch: typeof fetch}).fetch = jest.fn(async () => ({
    ok: false,
    status: 502,
    text: async () => '<html>Bad gateway</html>',
    headers: {get: () => null},
  })) as unknown as typeof fetch;

  renderer = await mount();
  await flush();
  await flush();

  expect(hasTestId(renderer, 'tab-service')).toBe(true);
  expect(hasTestId(renderer, 'offline-bar')).toBe(true);
  expect(textOf(renderer.toJSON())).toContain('Сервер не отвечает');
  await act(async () => renderer.unmount());
});

test('смена IP: внизу сразу видны запрос, команда и ожидание, затем дословный ответ сервера', async () => {
  mockServer('user');
  const renderer = await mount();
  await signIn(renderer);

  const base = (globalThis as {fetch: typeof fetch}).fetch;
  let release: () => void = () => undefined;
  (globalThis as {fetch: typeof fetch}).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/v1/control/rotate')) {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({text: 'новый адрес 203.0.113.9'}),
        headers: {get: () => null},
      };
    }
    return base(url, init);
  }) as unknown as typeof fetch;

  expect(hasTestId(renderer, 'server-log')).toBe(false);
  await act(async () => {
    byTestId(renderer, 'rotate', 'onPress').props.onPress();
  });

  let tree = textOf(renderer.toJSON());
  expect(hasTestId(renderer, 'server-log')).toBe(true);
  expect(tree).toContain('/v1/control/rotate');
  expect(tree).toContain('vampn rotate');
  expect(tree).toContain('ждём ответ');
  expect(tree).not.toContain('новый адрес');

  await act(async () => {
    release();
  });
  await flush();
  tree = textOf(renderer.toJSON());
  expect(tree).toContain('HTTP 200');
  expect(tree).toContain('новый адрес 203.0.113.9');
  await act(async () => renderer.unmount());
});

// ---------- серверы (ячейки), аренда и кабинеты Timeweb: только суперадмин ----------
const TWO_CELLS = {
  cells: [
    {cell: 1, name: 'vampn', ip: '203.0.113.7', users: 18, limit: 1000, handshake: '40s', state: 'активна'},
    {cell: 2, name: 'vampn_2', ip: '198.51.100.9', users: 0, limit: 1000, handshake: '12s', state: 'активна'},
  ],
};
const SECRET_TOKEN = 'eyJ0b2tlbiI6InNlY3JldC10aW1ld2ViIn0.abc-DEF_123456';

/** Подменяет ответы админских точек и записывает, что приложение туда отправило. */
function withServers(extra: Record<string, unknown> = {}) {
  const fetchMock = (globalThis as unknown as {fetch: jest.Mock}).fetch;
  const original = fetchMock.getMockImplementation()!;
  const sent: {method: string; path: string; body?: string}[] = [];
  const state = {spawn: {state: 'none', detail: '', log: [] as string[]}, cells: TWO_CELLS};
  const reply = (body: unknown, status = 200) => ({ok: status < 300, status, text: async () => JSON.stringify(body), headers: {get: () => null}});
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace('https://vamp.new.litewms.ru', '');
    const method = init?.method ?? 'GET';
    if (path === '/v1/admin/cells') {
      return reply(state.cells);
    }
    if (path === '/v1/admin/spawn' && method === 'GET') {
      return reply(state.spawn);
    }
    if (path === '/v1/admin/timeweb/accounts' && method === 'GET') {
      return reply({accounts: [{name: 'main', status: 'ok', balance: 5081.8, currency: 'RUB', default: true, message: null}]});
    }
    if (/^\/v1\/admin\/(spawn|cells\/\d+\/delete|timeweb\/accounts.*)$/.test(path)) {
      sent.push({method, path, body: init?.body === undefined ? undefined : String(init.body)});
      return reply((extra[`${method} ${path}`] as object) ?? {ok: true, text: 'принято'});
    }
    return original(url, init);
  });
  return {sent, state};
}

test('обычному пользователю серверы и аренда не показываются и не запрашиваются', async () => {
  const log = mockServer('user');
  withServers();
  const renderer = await mount();
  await signIn(renderer);
  expect(hasTestId(renderer, 'spawn')).toBe(false);
  expect(textOf(renderer.toJSON())).not.toContain('до 1000 человек');
  expect(log.some(call => call.path.startsWith('/v1/admin'))).toBe(false);
  await act(async () => renderer.unmount());
});

test('суперадмин видит ячейки; аренда не уходит, пока не подтвердили предупреждение о расходах', async () => {
  mockServer('admin');
  const {sent, state} = withServers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const renderer = await mount();
  await signIn(renderer);

  const tree = textOf(renderer.toJSON());
  expect(tree).toContain('vampn_2');
  expect(tree.replace(/\s+/g, ' ')).toContain('людей 18 из 1000');
  expect(hasTestId(renderer, 'cell-2')).toBe(true);

  await act(async () => {
    byTestId(renderer, 'spawn', 'onPress').props.onPress();
  });
  expect(alert.mock.calls[0][0]).toContain('Развернуть новый сервер');
  expect(alert.mock.calls[0][1]).toContain('платно');
  expect(alert.mock.calls[0][1]).toContain('Амстердам');
  expect(sent).toEqual([]); // без подтверждения ничего не арендуется

  state.spawn = {state: 'running', detail: 'ждём адрес сервера', log: ['2026-11-27 11:00:01 ячейка 3, имя vampn_3']};
  await act(async () => {
    alert.mock.calls[0][2]?.find(button => button.text === 'Арендовать')?.onPress?.();
  });
  await flush();
  expect(sent).toEqual([{method: 'POST', path: '/v1/admin/spawn', body: '{}'}]);
  const after = textOf(renderer.toJSON());
  expect(after).toContain('Идёт развёртывание: ждём адрес сервера');
  expect(after).toContain('имя vampn_3');
  expect(stateOf(renderer, 'spawn').disabled).toBe(true); // второй раз не нажать
  alert.mockRestore();
  await act(async () => renderer.unmount());
});

test('ход аренды обновляется сам, пока сервер разворачивается, и после завершения опрос прекращается', async () => {
  jest.useFakeTimers({doNotFake: ['setImmediate', 'nextTick']});
  mockServer('admin');
  const {state} = withServers();
  state.spawn = {state: 'running', detail: 'создание сервера vampn_3', log: []};
  const renderer = await mount();
  await signIn(renderer);
  expect(textOf(renderer.toJSON())).toContain('создание сервера vampn_3');

  state.spawn = {state: 'done', detail: 'ячейка 3 (vampn_3) 198.51.100.77', log: []};
  await act(async () => {
    jest.advanceTimersByTime(5100);
  });
  await flush();
  expect(textOf(renderer.toJSON())).toContain('Готово: ячейка 3 (vampn_3) 198.51.100.77');
  expect(stateOf(renderer, 'spawn').disabled).toBe(false);

  const fetchMock = (globalThis as unknown as {fetch: jest.Mock}).fetch;
  const calls = () => fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/v1/admin/spawn')).length;
  const before = calls();
  await act(async () => {
    jest.advanceTimersByTime(20000);
  });
  expect(calls()).toBe(before); // готово: опрос остановлен
  jest.useRealTimers();
  await act(async () => renderer.unmount());
});

test('сбой аренды показан как ошибка с причиной', async () => {
  mockServer('admin');
  const {state} = withServers();
  state.spawn = {state: 'failed', detail: 'создание сервера: Timeweb не создал сервер: Not enough funds', log: []};
  const renderer = await mount();
  await signIn(renderer);
  expect(textOf(renderer.toJSON())).toContain('Не удалось: создание сервера: Timeweb не создал сервер: Not enough funds');
  await act(async () => renderer.unmount());
});

test('удаление ячейки: только вторая и дальше, с подтверждением; ячейка 1 не удаляется', async () => {
  mockServer('admin');
  const {sent} = withServers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const renderer = await mount();
  await signIn(renderer);

  expect(renderer.root.findAll(node => node.props.testID === 'cell-1' && typeof node.props.onPress === 'function')).toHaveLength(0); // ячейку 1 удалить нельзя
  expect(hasTestId(renderer, 'cell-1')).toBe(true);
  await act(async () => {
    byTestId(renderer, 'cell-2', 'onPress').props.onPress();
  });
  expect(alert.mock.calls[0][0]).toContain('vampn_2');
  expect(alert.mock.calls[0][1]).toContain('нельзя отменить');
  expect(sent).toEqual([]);
  await act(async () => {
    alert.mock.calls[0][2]?.find(button => button.text === 'Удалить')?.onPress?.();
  });
  await flush();
  expect(sent).toEqual([{method: 'POST', path: '/v1/admin/cells/2/delete', body: JSON.stringify({confirm: true})}]);
  alert.mockRestore();
  await act(async () => renderer.unmount());
});

test('кабинеты Timeweb: токен уходит только в запросе добавления, на экране и в журнале его нет', async () => {
  mockServer('admin');
  const {sent} = withServers();
  const renderer = await mount();
  await signIn(renderer);

  await act(async () => {
    byTestId(renderer, 'accounts', 'onPress').props.onPress();
  });
  await flush();
  expect(textOf(renderer.toJSON())).toContain('токен принят');
  expect(textOf(renderer.toJSON())).toContain('Логин и пароль Timeweb приложению не нужны');
  expect(byTestId(renderer, 'acct-token', 'onChangeText').props.secureTextEntry).toBe(true);

  // плохое имя и мусор вместо токена не уходят
  await act(async () => {
    byTestId(renderer, 'acct-name', 'onChangeText').props.onChangeText('Bad Name');
    byTestId(renderer, 'acct-token', 'onChangeText').props.onChangeText(SECRET_TOKEN);
  });
  await act(async () => {
    byTestId(renderer, 'acct-add', 'onPress').props.onPress();
  });
  expect(textOf(renderer.toJSON())).toContain('Имя кабинета');
  await act(async () => {
    byTestId(renderer, 'acct-name', 'onChangeText').props.onChangeText('second');
    byTestId(renderer, 'acct-token', 'onChangeText').props.onChangeText('коротко');
  });
  await act(async () => {
    byTestId(renderer, 'acct-add', 'onPress').props.onPress();
  });
  expect(textOf(renderer.toJSON())).toContain('не похоже на токен');
  expect(sent).toEqual([]);

  await act(async () => {
    byTestId(renderer, 'acct-token', 'onChangeText').props.onChangeText('  ' + SECRET_TOKEN + '\n');
  });
  await act(async () => {
    byTestId(renderer, 'acct-add', 'onPress').props.onPress();
  });
  await flush();
  expect(sent).toEqual([{method: 'POST', path: '/v1/admin/timeweb/accounts', body: JSON.stringify({name: 'second', token: SECRET_TOKEN})}]);
  expect(textOf(renderer.toJSON())).not.toContain(SECRET_TOKEN); // ни в ответе, ни в журнале внизу экрана
  expect(byTestId(renderer, 'acct-token', 'onChangeText').props.value).toBe(''); // поле очищено
  await act(async () => renderer.unmount());
});

test('токен не попадает в журнал обмена с сервером', () => {
  const {ApiClient} = require('../src/api');
  const events: {phase: string; body?: string}[] = [];
  const client = new ApiClient({
    baseUrl: 'https://x.example',
    getToken: () => 'tok',
    onTrace: (e: {phase: string; body?: string}) => events.push(e),
    fetchImpl: async () => ({ok: true, status: 200, text: async () => '{"ok":true}', headers: {get: () => null}}),
  });
  return client.adminAddAccount('second', SECRET_TOKEN).then(() => {
    expect(events).toEqual([]);
    return client.adminSpawn().then(() => {
      expect(events.map(e => e.phase)).toEqual(['start', 'end']);
      expect(JSON.stringify(events)).not.toContain(SECRET_TOKEN);
    });
  });
});
