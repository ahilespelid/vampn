/**
 * @format
 */

import React from 'react';
import {AppState} from 'react-native';
import ReactTestRenderer, {act} from 'react-test-renderer';

import type {ApiClient, AppNotification} from '../src/api';
import type {StreamEnd} from '../src/sse';
import {
  LIVE_POLL_MS,
  POLL_MS,
  RECONNECT_AFTER_BYE_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  UNSUPPORTED_RETRY_MS,
  useNotifications,
} from '../src/useNotifications';
import type {NotificationsState} from '../src/useNotifications';

type Handlers = {onOpen?: () => void; onEvent: (event: string) => void; onEnd: (end: StreamEnd) => void};

function note(id: number, extra: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    user_name: 'griga',
    key_id: null,
    kind: 'key',
    title: `Ключ ${id}`,
    email_sent_at: null,
    push_sent_at: null,
    delivered_at: null,
    read_at: null,
    created_at: '2026-11-24T10:00:00Z',
    ...extra,
  };
}

function setup() {
  const server = {list: [note(1, {read_at: 'x', delivered_at: 'x'})]};
  const streams: {handlers: Handlers; close: jest.Mock}[] = [];
  const api = {
    notifications: jest.fn(async () => ({notifications: server.list})),
    markDelivered: jest.fn(async () => ({ok: true})),
    markRead: jest.fn(async () => ({ok: true})),
    notificationStream: jest.fn((handlers: Handlers) => {
      const close = jest.fn();
      streams.push({handlers, close});
      return {close};
    }),
  };
  let state: NotificationsState;
  let appStateListener: ((next: string) => void) | null = null;
  const removeListener = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (next: string) => void) => {
    appStateListener = listener;
    return {remove: removeListener};
  }) as unknown as typeof AppState.addEventListener);

  function Probe({enabled}: {enabled: boolean}) {
    state = useNotifications(api as unknown as ApiClient, enabled);
    return null;
  }

  return {
    server,
    streams,
    api,
    removeListener,
    state: () => state!,
    last: () => streams[streams.length - 1],
    appState: (next: string) => appStateListener?.(next),
    async mount(enabled = true) {
      let renderer: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = ReactTestRenderer.create(<Probe enabled={enabled} />);
      });
      return renderer!;
    },
  };
}

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

const ready = () => act(async () => {});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('при старте открывает поток; пока он не ответил, список опрашивается раз в 15 с', async () => {
  const t = setup();
  const renderer = await t.mount();
  expect(t.api.notificationStream).toHaveBeenCalledTimes(1);
  expect(t.api.notifications).toHaveBeenCalledTimes(1);

  await advance(POLL_MS);
  expect(t.api.notifications).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});

test('поток готов: список перечитывается, опрос становится редким', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEvent('ready'));
  expect(t.api.notifications).toHaveBeenCalledTimes(2);

  await advance(POLL_MS * 3);
  expect(t.api.notifications).toHaveBeenCalledTimes(2);
  await advance(LIVE_POLL_MS - POLL_MS * 3);
  expect(t.api.notifications).toHaveBeenCalledTimes(3);
  await act(async () => renderer.unmount());
});

test('событие changed сразу обновляет список и показывает баннер про новое уведомление', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEvent('ready'));
  expect(t.state().banner).toBeNull();

  t.server.list = [note(2), ...t.server.list];
  await act(async () => t.last().handlers.onEvent('changed'));
  expect(t.state().items.map(n => n.id)).toEqual([2, 1]);
  expect(t.state().banner?.id).toBe(2);
  expect(t.state().unread).toBe(1);
  expect(t.api.markDelivered).toHaveBeenCalledWith(2);
  await act(async () => renderer.unmount());
});

test('несколько changed подряд: устаревший ответ не затирает свежий', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEvent('ready'));

  const answers: ((value: {notifications: AppNotification[]}) => void)[] = [];
  t.api.notifications.mockImplementation(
    () => new Promise(resolve => answers.push(resolve as (value: {notifications: AppNotification[]}) => void)),
  );
  act(() => {
    t.last().handlers.onEvent('changed');
    t.last().handlers.onEvent('changed');
  });
  const fresh = [note(3), note(1, {read_at: 'x', delivered_at: 'x'})];
  await act(async () => answers[1]({notifications: fresh})); // свежий пришёл первым
  await act(async () => answers[0]({notifications: [note(1, {read_at: 'x', delivered_at: 'x'})]})); // старый позже
  expect(t.state().items.map(n => n.id)).toEqual([3, 1]);
  await act(async () => renderer.unmount());
});

test('обрыв: возвращается опрос раз в 15 с, переподключение через 3 с, потом вдвое дольше', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEvent('ready'));

  await act(async () => t.last().handlers.onEnd({status: 0, reason: 'network'}));
  expect(t.api.notificationStream).toHaveBeenCalledTimes(1);
  await advance(RECONNECT_MIN_MS);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(2);

  // второй подряд обрыв до ready: задержка 6 с
  await act(async () => t.last().handlers.onEnd({status: 0, reason: 'network'}));
  await advance(RECONNECT_MIN_MS * 2 - 1);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(3);

  // пока потока нет, список опрашивается
  const before = t.api.notifications.mock.calls.length;
  await advance(POLL_MS);
  expect(t.api.notifications.mock.calls.length).toBeGreaterThan(before);
  await act(async () => renderer.unmount());
});

test('задержка переподключения не растёт выше минуты, а ready сбрасывает счётчик', async () => {
  const t = setup();
  const renderer = await t.mount();
  for (let i = 0; i < 8; i += 1) {
    await act(async () => t.last().handlers.onEnd({status: 0, reason: 'network'}));
    await advance(RECONNECT_MAX_MS);
  }
  const opened = t.api.notificationStream.mock.calls.length;
  await act(async () => t.last().handlers.onEnd({status: 0, reason: 'network'}));
  await advance(RECONNECT_MAX_MS);
  expect(t.api.notificationStream.mock.calls.length).toBe(opened + 1);

  await act(async () => t.last().handlers.onEvent('ready'));
  await act(async () => t.last().handlers.onEnd({status: 0, reason: 'network'}));
  await advance(RECONNECT_MIN_MS);
  expect(t.api.notificationStream.mock.calls.length).toBe(opened + 2);
  await act(async () => renderer.unmount());
});

test('плановое закрытие (bye) не считается ошибкой: подключение почти сразу', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEvent('ready'));
  await act(async () => t.last().handlers.onEvent('bye'));
  await act(async () => t.last().handlers.onEnd({status: 200, reason: 'ended'}));
  await advance(RECONNECT_AFTER_BYE_MS);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});

test('сервер без потока (404): запасной опрос работает, новая попытка только через 10 минут', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEnd({status: 404, reason: 'http'}));

  await advance(UNSUPPORTED_RETRY_MS - 1);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(1);
  expect(t.api.notifications.mock.calls.length).toBeGreaterThan(10);
  await advance(1);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});

test('поток открыть нельзя (исключение): экран не падает, опрос идёт, повтор через 10 минут', async () => {
  const t = setup();
  t.api.notificationStream.mockImplementation(() => {
    throw new ReferenceError('XMLHttpRequest is not defined');
  });
  const renderer = await t.mount();
  expect(t.api.notificationStream).toHaveBeenCalledTimes(1);

  await advance(POLL_MS);
  expect(t.api.notifications).toHaveBeenCalledTimes(2);
  await advance(UNSUPPORTED_RETRY_MS);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});

test('unauthorized и 401: список запрашивается, чтобы обычный 401 сбросил сессию', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEvent('ready'));
  const before = t.api.notifications.mock.calls.length;
  await act(async () => t.last().handlers.onEvent('unauthorized'));
  expect(t.api.notifications.mock.calls.length).toBe(before + 1);

  await act(async () => t.last().handlers.onEnd({status: 401, reason: 'http'}));
  expect(t.api.notifications.mock.calls.length).toBe(before + 2);
  await act(async () => renderer.unmount());
});

test('приложение ушло в фон: поток закрыт, опроса нет; вернулось: список и поток снова', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEvent('ready'));
  const first = t.last();

  act(() => t.appState('background'));
  expect(first.close).toHaveBeenCalledTimes(1);
  const calls = t.api.notifications.mock.calls.length;
  await advance(LIVE_POLL_MS * 3);
  expect(t.api.notifications.mock.calls.length).toBe(calls);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(1);

  await act(async () => t.appState('active'));
  expect(t.api.notifications.mock.calls.length).toBe(calls + 1);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});

test('события закрытого потока игнорируются', async () => {
  const t = setup();
  const renderer = await t.mount();
  const old = t.last();
  act(() => t.appState('background'));
  const calls = t.api.notifications.mock.calls.length;
  await act(async () => old.handlers.onEvent('changed'));
  await act(async () => old.handlers.onEnd({status: 0, reason: 'network'}));
  await advance(RECONNECT_MAX_MS * 2);
  expect(t.api.notifications.mock.calls.length).toBe(calls);
  expect(t.api.notificationStream).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test('размонтирование закрывает поток и останавливает таймеры', async () => {
  const t = setup();
  const renderer = await t.mount();
  await act(async () => t.last().handlers.onEvent('ready'));
  const stream = t.last();
  await act(async () => renderer.unmount());
  expect(stream.close).toHaveBeenCalledTimes(1);
  expect(t.removeListener).toHaveBeenCalledTimes(1);
  const calls = t.api.notifications.mock.calls.length;
  await advance(LIVE_POLL_MS * 2);
  expect(t.api.notifications.mock.calls.length).toBe(calls);
});

test('выключенный хук (нет сессии) поток не открывает', async () => {
  const t = setup();
  const renderer = await t.mount(false);
  await ready();
  expect(t.api.notificationStream).not.toHaveBeenCalled();
  expect(t.api.notifications).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});
