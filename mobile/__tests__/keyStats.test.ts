import type {KeyEvent, KeyStats, KeyStatsTotals} from '../src/api';
import {formatAgo, formatBytes, formatDate, formatDay, removedReasonLabel} from '../src/format';
import {dailySeries, eventText, hasData, isRemoved, periodTraffic, serverText, sortKeys, trackedSince} from '../src/keyStats';

function key(name: string, extra: Partial<KeyStats> = {}): KeyStats {
  return {
    name,
    role: 'user',
    active: true,
    added_at: null,
    removed_at: null,
    removed_reason: null,
    tracked_since: null,
    first_seen_at: null,
    last_seen_at: null,
    online: false,
    connections: 0,
    up_total: 0,
    down_total: 0,
    up_24h: 0,
    down_24h: 0,
    up_7d: 0,
    down_7d: 0,
    up_30d: 0,
    down_30d: 0,
    last_client_ip: null,
    last_server: null,
    last_server_ip: null,
    ...extra,
  };
}

const totalsOf = (extra: Partial<KeyStatsTotals> = {}): KeyStatsTotals => ({
  keys: 1,
  online: 0,
  connections: 0,
  up_total: 0,
  down_total: 0,
  up_24h: 0,
  down_24h: 0,
  up_7d: 0,
  down_7d: 0,
  up_30d: 0,
  down_30d: 0,
  ...extra,
});

const MB = 1048576;

describe('formatBytes', () => {
  test('ноль, минус и мусор - «0 МБ»', () => {
    expect(formatBytes(0)).toBe('0 МБ');
    expect(formatBytes(-5)).toBe('0 МБ');
    expect(formatBytes(NaN)).toBe('0 МБ');
  });

  test('байты, килобайты, мегабайты, гигабайты с запятой', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1536)).toBe('1,50 КБ');
    expect(formatBytes(5 * MB)).toBe('5,00 МБ');
    expect(formatBytes(Math.round(12.3 * MB))).toBe('12,3 МБ');
    expect(formatBytes(150 * MB)).toBe('150 МБ');
    expect(formatBytes(1024 * MB)).toBe('1,00 ГБ');
    expect(formatBytes(1024 ** 5)).toBe('1024 ТБ');
  });

  test('1023,9 КБ не показывается как «1024 КБ»', () => {
    expect(formatBytes(1048473)).toBe('1,00 МБ');
  });
});

describe('formatAgo', () => {
  const now = Date.parse('2026-11-26T10:00:00Z');

  test('нет времени и мусор', () => {
    expect(formatAgo(null, now)).toBe('никогда');
    expect(formatAgo(undefined, now)).toBe('никогда');
    expect(formatAgo('что-то', now)).toBe('—');
  });

  test('секунды, минуты, часы', () => {
    expect(formatAgo('2026-11-26T09:59:30Z', now)).toBe('только что');
    expect(formatAgo('2026-11-26T10:05:00Z', now)).toBe('только что'); // время из будущего не уходит в минус
    expect(formatAgo('2026-11-26T09:55:00Z', now)).toBe('5 мин назад');
    expect(formatAgo('2026-11-26T07:00:00Z', now)).toBe('3 ч назад');
  });

  test('старше суток - дата', () => {
    expect(formatAgo('2026-11-20T10:00:00Z', now)).toBe(formatDate('2026-11-20T10:00:00Z'));
  });
});

test('formatDay и причины удаления', () => {
  expect(formatDay('2026-11-24')).toBe('24.11');
  expect(formatDay('x')).toBe('x');
  expect(removedReasonLabel('revoked_in_app')).toBe('отозван в приложении');
  expect(removedReasonLabel('removed_from_file')).toBe('убран из файла пользователей');
  expect(removedReasonLabel('revoked_in_db')).toBe('отозван в базе');
  expect(removedReasonLabel('что-то новое')).toBe('что-то новое');
  expect(removedReasonLabel(null)).toBe('');
});

test('periodTraffic берёт нужный срок', () => {
  const k = key('a', {up_24h: 1, down_24h: 2, up_7d: 3, down_7d: 4, up_30d: 5, down_30d: 6, up_total: 7, down_total: 8});
  expect(periodTraffic(k, '24h')).toEqual({up: 1, down: 2});
  expect(periodTraffic(k, '7d')).toEqual({up: 3, down: 4});
  expect(periodTraffic(k, '30d')).toEqual({up: 5, down: 6});
  expect(periodTraffic(k, 'total')).toEqual({up: 7, down: 8});
});

test('sortKeys: по трафику за срок, при равенстве по имени, исходный список цел', () => {
  const list = [key('b', {up_total: 1}), key('a', {up_total: 1}), key('c', {down_total: 50}), key('d', {up_24h: 100})];
  expect(sortKeys(list, 'total').map(k => k.name)).toEqual(['c', 'a', 'b', 'd']);
  expect(sortKeys(list, '24h').map(k => k.name)).toEqual(['d', 'a', 'b', 'c']);
  expect(list.map(k => k.name)).toEqual(['b', 'a', 'c', 'd']);
});

test('isRemoved: только явно отозванный; ключ без пользователя в базе живой', () => {
  expect(isRemoved(key('a', {active: false}))).toBe(true);
  expect(isRemoved(key('a', {active: true}))).toBe(false);
  expect(isRemoved(key('a', {active: null}))).toBe(false);
});

test('trackedSince: самое раннее начало учёта', () => {
  expect(trackedSince([])).toBeNull();
  expect(trackedSince([key('a')])).toBeNull();
  expect(trackedSince([key('a', {tracked_since: '2026-11-22T00:00:00Z'}), key('b', {tracked_since: '2026-11-20T00:00:00Z'}), key('c')])).toBe(
    '2026-11-20T00:00:00Z',
  );
});

test('hasData: нет ни трафика, ни подключений, ни замеченных ключей - учёт ещё не начался', () => {
  expect(hasData(totalsOf(), [key('a')])).toBe(false);
  expect(hasData(totalsOf({down_total: 1}), [key('a')])).toBe(true);
  expect(hasData(totalsOf({connections: 2}), [key('a')])).toBe(true);
  expect(hasData(totalsOf(), [key('a', {last_seen_at: '2026-11-26T10:00:00Z'})])).toBe(true);
});

test('dailySeries: последние сутки по UTC, пустые дни - нули, лишнее отбрасывается', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  const series = dailySeries(
    [
      {day: '2026-11-23', up: 1, down: 2},
      {day: '2026-10-01', up: 9, down: 9},
    ],
    3,
    now,
  );
  expect(series).toEqual([
    {day: '2026-11-22', bytes: 0},
    {day: '2026-11-23', bytes: 3},
    {day: '2026-11-24', bytes: 0},
  ]);
  expect(dailySeries([], 30, now)).toHaveLength(30);
});

test('serverText', () => {
  expect(serverText('основной', '198.51.100.7')).toBe('основной · 198.51.100.7');
  expect(serverText('аварийный', null)).toBe('аварийный');
  expect(serverText(null, '1.2.3.4')).toBe('1.2.3.4');
  expect(serverText(null, undefined)).toBe('');
});

describe('eventText', () => {
  const base: KeyEvent = {at: '2026-11-26T10:00:00Z', kind: 'connect', key: 'griga', old: null, new: null, server: null, server_ip: null};

  test('подключение: откуда и на какой сервер', () => {
    expect(eventText({...base, new: '203.0.113.5', server: 'основной', server_ip: '198.51.100.7'})).toEqual({
      title: 'подключение',
      sub: 'с 203.0.113.5 · сервер основной · 198.51.100.7',
    });
    expect(eventText(base)).toEqual({title: 'подключение', sub: 'IP клиента неизвестен'});
  });

  test('смены адресов и сервера', () => {
    expect(eventText({...base, kind: 'client_ip', old: 'a', new: 'b'})).toEqual({title: 'сменился IP клиента', sub: 'a → b'});
    expect(eventText({...base, kind: 'server_ip', key: null, old: 'a', new: 'b'})).toEqual({title: 'сменился IP сервера', sub: 'a → b'});
    expect(eventText({...base, kind: 'server_switch', key: null, old: 'основной', new: 'аварийный'})).toEqual({
      title: 'переключили сервер',
      sub: 'основной → аварийный',
    });
  });

  test('незнакомый вид события не ломает список', () => {
    expect(eventText({...base, kind: 'новое'})).toEqual({title: 'новое', sub: ''});
  });
});
