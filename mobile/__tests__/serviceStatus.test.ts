import {cabinetState, parseCabinets, parseEmergency, parseStatus} from '../src/serviceStatus';

const OK = [
  'туннель : рукопожатие 12 с назад (сервер отвечает через туннель)',
  'сервер : 203.0.113.7:51820',
  'Timeweb : статус active, IPv4 203.0.113.7',
  'без связи : 0 мин (порог 5 мин)',
  'аварийный : выключен',
  'смены IP :',
  '  2026-11-20 03:10  198.51.100.4 -> 203.0.113.7',
].join('\n');

test('рабочий сервер: адрес без порта, туннель и время без связи без пояснений в скобках', () => {
  expect(parseStatus(OK)).toEqual({
    state: 'ok',
    ip: '203.0.113.7',
    tunnel: 'рукопожатие 12 с назад',
    fails: '0 мин',
  });
});

test('нет ответа через туннель: состояние «не отвечает»', () => {
  const text = OK.replace('сервер отвечает через туннель', 'ответа через туннель нет; ждём');
  expect(parseStatus(text).state).toBe('down');
});

test('непонятный текст не ломает разбор', () => {
  expect(parseStatus('watcher: ok')).toEqual({state: 'unknown', ip: '', tunnel: '', fails: ''});
  expect(parseStatus('')).toEqual({state: 'unknown', ip: '', tunnel: '', fails: ''});
});

// строки так, как их печатает `vampn status`: после списка IPv4 стоит пробел, у неактивного кабинета нет слова «активный»
const TWO = [
  'туннель      : рукопожатие 12 с назад (сервер отвечает через туннель; мёртв, если рукопожатие > 180 с и ответа нет)',
  'сервер       : 203.0.113.7:51820',
  'Timeweb (основной): статус on, IPv4 198.51.100.4 , новых IP за сутки 9 из 10; смена IP на паузе до 27.11 03:00 МСК',
  'Timeweb (запасной, активный): статус on, IPv4 203.0.113.7 203.0.113.8 , новых IP за сутки 2 из 10',
  'без связи    : 0 мин (перезагрузка с 2, смена IP с 5), попыток вернуть связь 0 из 20',
].join('\n');

describe('parseCabinets', () => {
  test('два кабинета: номер, активный, статус, адреса, счётчик и пауза', () => {
    expect(parseCabinets(TWO)).toEqual([
      {server: 1, label: 'основной', active: false, state: 'on', ips: ['198.51.100.4'], used: 9, limit: 10, note: 'смена IP на паузе до 27.11 03:00 МСК'},
      {server: 2, label: 'запасной', active: true, state: 'on', ips: ['203.0.113.7', '203.0.113.8'], used: 2, limit: 10, note: ''},
    ]);
  });

  test('сервер выключен и без адресов', () => {
    const [c] = parseCabinets('Timeweb (запасной): статус off, IPv4 , новых IP за сутки 0 из 10');
    expect(c).toMatchObject({server: 2, active: false, state: 'off', ips: [], used: 0, limit: 10, note: ''});
  });

  test('один кабинет - один элемент (экран выбор не показывает)', () => {
    expect(parseCabinets('Timeweb (основной, активный): статус on, IPv4 203.0.113.7 , новых IP за сутки 1 из 10')).toHaveLength(1);
  });

  test('старый формат, мусор и пустой текст дают пустой список и ничего не ломают', () => {
    expect(parseCabinets(OK)).toEqual([]);
    expect(parseCabinets('watcher: ok')).toEqual([]);
    expect(parseCabinets('')).toEqual([]);
  });

  test('строка кабинета не мешает разбору остального статуса', () => {
    expect(parseStatus(TWO)).toEqual({state: 'ok', ip: '203.0.113.7', tunnel: 'рукопожатие 12 с назад', fails: '0 мин'});
  });
});

test('cabinetState: статус Timeweb словами', () => {
  expect(cabinetState('on')).toEqual({text: 'включён', tone: 'ok'});
  expect(cabinetState('off')).toEqual({text: 'выключен', tone: 'signal'});
  expect(cabinetState('rebooting')).toEqual({text: 'перезагружается', tone: 'muted'});
  expect(cabinetState('unknown')).toEqual({text: 'unknown', tone: 'muted'});
  expect(cabinetState('')).toEqual({text: 'нет данных', tone: 'muted'});
});

test('аварийный канал: включён, выключен, неизвестно', () => {
  expect(parseEmergency('аварийный режим: ВКЛЮЧЁН (с 03:10)')).toBe('on');
  expect(parseEmergency('аварийный режим: выключен')).toBe('off');
  expect(parseEmergency('off')).toBe('unknown');
  expect(parseEmergency('')).toBe('unknown');
});
