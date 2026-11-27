import {cellFree, cellTone, spawnBusy, spawnTitle, validAccountName, validTimewebToken} from '../src/servers';

test('имя кабинета: как проверяет сервер', () => {
  for (const ok of ['second', 'acc-2_x', '1', 'a'.repeat(24)]) {
    expect(validAccountName(ok)).toBe(true);
  }
  for (const bad of ['', 'Second', 'a b', '-x', '_x', 'a'.repeat(25), 'main', 'spare', 'x;id', 'имя']) {
    expect(validAccountName(bad)).toBe(false);
  }
});

test('токен Timeweb: длинная строка без пробелов, края обрезаются', () => {
  expect(validTimewebToken('  eyJ0b2tlbiI6InNlY3JldC10aW1ld2ViIn0.abc-DEF_123456\n')).toBe(true);
  for (const bad of ['', 'short', 'has space in the middle of token', 'a;rm -rf /;aaaaaaaaaaaaaaaaaaaaa', 'токен'.repeat(10)]) {
    expect(validTimewebToken(bad)).toBe(false);
  }
});

test('состояние аренды и ячеек', () => {
  expect(spawnBusy('queued')).toBe(true);
  expect(spawnBusy('running')).toBe(true);
  expect(spawnBusy('done')).toBe(false);
  expect(spawnBusy('failed')).toBe(false);
  expect(spawnBusy(undefined)).toBe(false);
  expect(cellTone('активна')).toBe('ok');
  expect(cellTone('ошибка')).toBe('signal');
  expect(cellTone('создаётся')).toBe('muted');
  expect(cellFree({users: 18, limit: 1000})).toBe(982);
  expect(cellFree({users: 1200, limit: 1000})).toBe(0);
  expect(spawnTitle(null)).toBe('');
  expect(spawnTitle({state: 'none', detail: '', log: []})).toBe('');
  expect(spawnTitle({state: 'running', detail: 'ждём IP', log: []})).toBe('Идёт развёртывание: ждём IP');
  expect(spawnTitle({state: 'failed', detail: 'шаг: причина', log: []})).toBe('Не удалось: шаг: причина');
});
