import {ApiClient} from '../src/api';
import {openEventStream, STREAM_IDLE_MS, takeFrames} from '../src/sse';
import type {StreamEnd} from '../src/sse';

/** Подмена XMLHttpRequest: тест сам решает, что и когда «пришло по сети». */
class FakeXhr {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 0;
  readyState = 0;
  responseText = '';
  timeout = -1;
  sent = false;
  aborted = false;
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    this.sent = true;
  }
  abort() {
    this.aborted = true;
  }

  respond(status: number) {
    this.status = status;
    this.readyState = 2;
    this.onreadystatechange?.();
  }
  push(chunk: string) {
    this.readyState = 3;
    this.responseText += chunk;
    this.onprogress?.();
  }
  finish() {
    this.readyState = 4;
    this.onload?.();
  }
}

function open(overrides: Partial<Parameters<typeof openEventStream>[0]> = {}) {
  const xhr = new FakeXhr();
  const events: string[] = [];
  const ends: StreamEnd[] = [];
  let opened = 0;
  const handle = openEventStream({
    url: 'https://api.test/v1/notifications/stream',
    headers: {Authorization: 'Bearer tok-1'},
    onOpen: () => {
      opened += 1;
    },
    onEvent: event => events.push(event),
    onEnd: end => ends.push(end),
    xhrFactory: () => xhr as unknown as XMLHttpRequest,
    ...overrides,
  });
  return {xhr, events, ends, handle, opened: () => opened};
}

describe('takeFrames', () => {
  test('достаёт законченные кадры и оставляет хвост', () => {
    const text = 'retry: 3000\n\nevent: ready\ndata: {}\n\nevent: chang';
    const {frames, consumed} = takeFrames(text);
    expect(frames).toEqual([{event: 'ready', data: '{}'}]);
    expect(text.slice(consumed)).toBe('event: chang');
  });

  test('понимает CRLF, пробел после двоеточия и кадр без имени', () => {
    const {frames} = takeFrames('event: changed\r\ndata: {"a": 1}\r\n\r\ndata:x\n\n');
    expect(frames).toEqual([
      {event: 'changed', data: '{"a": 1}'},
      {event: 'message', data: 'x'},
    ]);
  });

  test('комментарии («пинг») и retry кадров не дают', () => {
    expect(takeFrames(': ping\n\nretry: 3000\n\n').frames).toEqual([]);
  });

  test('пустой текст и текст без пустой строки ничего не отдают', () => {
    expect(takeFrames('')).toEqual({frames: [], consumed: 0});
    expect(takeFrames('event: ready\ndata: {}\n')).toEqual({frames: [], consumed: 0});
  });
});

describe('openEventStream', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('отправляет GET с заголовками и без таймаута', () => {
    const {xhr} = open();
    expect(xhr.sent).toBe(true);
    expect(xhr.method).toBe('GET');
    expect(xhr.url).toBe('https://api.test/v1/notifications/stream');
    expect(xhr.headers.Accept).toBe('text/event-stream');
    expect(xhr.headers['Cache-Control']).toBe('no-cache');
    expect(xhr.headers.Authorization).toBe('Bearer tok-1');
    expect(xhr.timeout).toBe(0);
  });

  test('события приходят по мере поступления, в том числе кадр, разрезанный пополам', () => {
    const {xhr, events, opened} = open();
    xhr.respond(200);
    expect(opened()).toBe(1);
    xhr.push('retry: 3000\n\nevent: rea');
    expect(events).toEqual([]);
    xhr.push('dy\ndata: {}\n\n');
    xhr.push(': ping\n\nevent: changed\ndata: {}\n\n');
    xhr.push('event: changed\ndata: {}\n\n');
    expect(events).toEqual(['ready', 'changed', 'changed']);
  });

  test('onOpen вызывается один раз, даже если данные пошли сразу', () => {
    const {xhr, opened} = open();
    xhr.respond(200);
    xhr.push('event: ready\ndata: {}\n\n');
    xhr.push(': ping\n\n');
    expect(opened()).toBe(1);
  });

  test('сервер закрыл поток: последние кадры не теряются, причина «ended»', () => {
    const {xhr, events, ends} = open();
    xhr.respond(200);
    xhr.status = 200;
    xhr.responseText = 'event: ready\ndata: {}\n\nevent: bye\ndata: {}\n\n';
    xhr.finish();
    expect(events).toEqual(['ready', 'bye']);
    expect(ends).toEqual([{status: 200, reason: 'ended'}]);
  });

  test('ответ не 200: onOpen и события не вызываются, код передаётся', () => {
    const {xhr, events, ends, opened} = open();
    xhr.respond(401);
    xhr.push('{"error":"unauthorized"}');
    xhr.finish();
    expect(opened()).toBe(0);
    expect(events).toEqual([]);
    expect(ends).toEqual([{status: 401, reason: 'http'}]);
  });

  test('сеть пропала: причина «network», статус 0', () => {
    const {xhr, ends} = open();
    xhr.onerror?.();
    xhr.onerror?.();
    expect(ends).toEqual([{status: 0, reason: 'network'}]);
  });

  test('тишина дольше порога: соединение обрывается и считается мёртвым', () => {
    const {xhr, ends} = open();
    xhr.respond(200);
    jest.advanceTimersByTime(STREAM_IDLE_MS - 1);
    expect(ends).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(xhr.aborted).toBe(true);
    expect(ends).toEqual([{status: 200, reason: 'idle'}]);
  });

  test('любые данные, в том числе «пинг», сдвигают отсчёт тишины', () => {
    const {xhr, ends} = open();
    xhr.respond(200);
    jest.advanceTimersByTime(STREAM_IDLE_MS - 1000);
    xhr.push(': ping\n\n');
    jest.advanceTimersByTime(STREAM_IDLE_MS - 1000);
    expect(ends).toEqual([]);
    jest.advanceTimersByTime(1000);
    expect(ends).toHaveLength(1);
  });

  test('close(): запрос прерван, дальше ни событий, ни onEnd', () => {
    const {xhr, events, ends, handle} = open();
    xhr.respond(200);
    handle.close();
    expect(xhr.aborted).toBe(true);
    xhr.push('event: changed\ndata: {}\n\n');
    xhr.onabort?.();
    jest.advanceTimersByTime(STREAM_IDLE_MS * 2);
    expect(events).toEqual([]);
    expect(ends).toEqual([]);
  });

  test('close() из обработчика события: остальные кадры той же порции не доставляются', () => {
    const xhr = new FakeXhr();
    const events: string[] = [];
    const stream = openEventStream({
      url: 'https://api.test/v1/notifications/stream',
      onEvent: event => {
        events.push(event);
        stream.close();
      },
      onEnd: () => {},
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    xhr.respond(200);
    xhr.push('event: ready\ndata: {}\n\nevent: changed\ndata: {}\n\n');
    expect(events).toEqual(['ready']);
  });
});

describe('ApiClient.notificationStream', () => {
  test('идёт на /v1/notifications/stream с токеном сессии', () => {
    const xhr = new FakeXhr();
    const api = new ApiClient({
      baseUrl: 'https://api.test/',
      getToken: () => 'tok-9',
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    const events: string[] = [];
    api.notificationStream({onEvent: event => events.push(event), onEnd: () => {}});
    expect(xhr.url).toBe('https://api.test/v1/notifications/stream');
    expect(xhr.headers.Authorization).toBe('Bearer tok-9');
    xhr.respond(200);
    xhr.push('event: changed\ndata: {}\n\n');
    expect(events).toEqual(['changed']);
  });

  test('без токена заголовок Authorization не ставится', () => {
    const xhr = new FakeXhr();
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      getToken: () => null,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    api.notificationStream({onEvent: () => {}, onEnd: () => {}});
    expect(xhr.headers.Authorization).toBeUndefined();
  });
});
