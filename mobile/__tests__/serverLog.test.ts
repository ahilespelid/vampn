import {ApiClient, type TraceEvent} from '../src/api';
import {formatClock, formatElapsed} from '../src/format';
import {reduceTrace, type LogEntry} from '../src/serverLog';

const start = (id: number, at = 1000): TraceEvent => ({
  phase: 'start',
  id,
  at,
  method: 'POST',
  path: '/v1/control/rotate',
  body: '{"force":false}',
  command: 'vampn rotate',
});

test('начало запроса добавляет запись сверху в состоянии «ждём»', () => {
  const list = reduceTrace(reduceTrace([], start(1)), start(2));
  expect(list.map(e => e.id)).toEqual([2, 1]);
  expect(list[0]).toMatchObject({state: 'pending', command: 'vampn rotate', body: '{"force":false}'});
});

test('конец запроса дописывает ответ, статус и время, остальные записи не трогает', () => {
  const list = reduceTrace(reduceTrace([], start(1)), start(2));
  const done = reduceTrace(list, {phase: 'end', id: 1, ms: 3400, ok: true, status: 200, response: 'IP сменён'});
  expect(done.find(e => e.id === 1)).toMatchObject({state: 'ok', status: 200, ms: 3400, response: 'IP сменён'});
  expect(done.find(e => e.id === 2)?.state).toBe('pending');

  const failed = reduceTrace(done, {phase: 'end', id: 2, ms: 10, ok: false, status: 0, response: 'Нет ответа: связь оборвалась.'});
  expect(failed.find(e => e.id === 2)).toMatchObject({state: 'error', status: 0});
});

test('в журнале не больше 30 записей', () => {
  let list: LogEntry[] = [];
  for (let id = 1; id <= 40; id += 1) {
    list = reduceTrace(list, start(id));
  }
  expect(list).toHaveLength(30);
  expect(list[0].id).toBe(40);
});

test('время и длительность выводятся по-русски', () => {
  expect(formatElapsed(3400)).toBe('3,4 с');
  expect(formatElapsed(45000)).toBe('45 с');
  expect(formatElapsed(125000)).toBe('2 мин 5 с');
  expect(formatElapsed(-5)).toBe('0 с');
  expect(formatClock(new Date(2026, 10, 26, 4, 5, 9).getTime())).toBe('04:05:09');
});

function clientWith(events: TraceEvent[], respond: () => Promise<unknown>) {
  return new ApiClient({
    baseUrl: 'https://example.test',
    getToken: () => 'secret-token',
    onTrace: event => events.push(event),
    fetchImpl: respond as unknown as typeof fetch,
  });
}

const reply = (status: number, body: string) => async () => ({
  ok: status < 300,
  status,
  text: async () => body,
  headers: {get: () => null},
});

test('смена IP: в журнал уходят запрос, команда и вывод сервера дословно, токен не попадает', async () => {
  const events: TraceEvent[] = [];
  const api = clientWith(events, reply(200, JSON.stringify({text: 'новый адрес 203.0.113.9\nключи обновлены'})));
  await api.rotate(true);

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({phase: 'start', method: 'POST', path: '/v1/control/rotate', body: '{"force":true}', command: 'vampn rotate --force'});
  expect(events[1]).toMatchObject({phase: 'end', ok: true, status: 200, response: 'новый адрес 203.0.113.9\nключи обновлены'});
  expect(JSON.stringify(events)).not.toContain('secret-token');
});

test('ошибка сервера: в журнал идёт тело ответа как есть', async () => {
  const events: TraceEvent[] = [];
  const body = JSON.stringify({error: 'command_failed', message: 'vampn: rotate: нет связи с Timeweb'});
  const api = clientWith(events, reply(500, body));
  await expect(api.reboot(false)).rejects.toMatchObject({code: 'command_failed'});

  expect(events[0]).toMatchObject({command: 'vampn reboot'});
  expect(events[1]).toMatchObject({phase: 'end', ok: false, status: 500, response: body});
});

test('обрыв связи: запись закрывается без ответа', async () => {
  const events: TraceEvent[] = [];
  const api = clientWith(events, async () => {
    throw new TypeError('Network request failed');
  });
  await expect(api.server()).rejects.toMatchObject({code: 'network'});

  expect(events[0]).toMatchObject({phase: 'start', command: 'vampn server'});
  expect(events[1]).toMatchObject({phase: 'end', ok: false, status: 0});
});

test('статус и состояние аварийного канала в журнал не пишутся, включение пишется', async () => {
  const events: TraceEvent[] = [];
  const api = clientWith(events, reply(200, JSON.stringify({text: 'ok'})));
  await api.status();
  await api.emergency('status');
  expect(events).toHaveLength(0);

  await api.emergency('on');
  expect(events[0]).toMatchObject({phase: 'start', command: 'vampn emergency on'});
});
