import {parseEmergency, parseStatus} from '../src/serviceStatus';

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

test('аварийный канал: включён, выключен, неизвестно', () => {
  expect(parseEmergency('аварийный режим: ВКЛЮЧЁН (с 03:10)')).toBe('on');
  expect(parseEmergency('аварийный режим: выключен')).toBe('off');
  expect(parseEmergency('off')).toBe('unknown');
  expect(parseEmergency('')).toBe('unknown');
});
