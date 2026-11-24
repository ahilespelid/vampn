/**
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

import App from '../App';

type Route = {status?: number; body: unknown};

function mockServer(role: 'admin' | 'user') {
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
});

test('без сессии показывается вход по почте', async () => {
  mockServer('user');
  const renderer = await mount();
  const tree = textOf(renderer.toJSON());
  expect(tree).toContain('vampn');
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
